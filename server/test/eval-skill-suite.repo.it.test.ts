import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { EvalRepository } from '../src/modules/eval/repository.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval-skill-suite.repo] Docker not available — skipping integration tests.');
}

/**
 * Phase 2 (T4–T9) — the differential skill-eval data layer:
 * `eval_skill_suite_runs` (the skill-suite parent), the second
 * `eval_runs.skill_suite_run_id` FK, the mirrored `eval-skill-suite.repo`
 * aggregate module + facade, `eval-run.repo` extensions, and the cross-cutting
 * host / skill reads the service needs. Proves the GENERATED migration
 * (`0021_marvelous_arachne.sql`) created the table + column and that every repo
 * method behaves as designed. → AC-4, AC-11, AC-17, AC-19, AC-22, AC-28, AC-31.
 */
d('skill-eval data layer (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repo: EvalRepository;
  let agentsRepo: AgentsRepository;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db
      .select()
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));
    workspaceId = ws!.id;
    repo = new EvalRepository(pg.handle.db);
    agentsRepo = new AgentsRepository(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const db = () => pg.handle.db;

  /** Insert a skill + snapshot its `skill_versions` row (seed-snapshot rule). */
  async function seedSkill(opts: { enabled?: boolean; version?: number; body?: string } = {}) {
    const version = opts.version ?? 1;
    const body = opts.body ?? 'skill body';
    const [skill] = await db()
      .insert(t.skills)
      .values({
        workspaceId,
        name: `Skill ${seq++}`,
        description: 'x',
        type: 'custom',
        source: 'manual',
        body,
        enabled: opts.enabled ?? true,
        version,
      })
      .returning();
    await db().insert(t.skillVersions).values({ skillId: skill!.id, version, body });
    return skill!;
  }

  /** Insert an agent (optionally linking a skill) in this workspace. */
  async function seedAgent(opts: { enabled?: boolean; linkSkillId?: string } = {}) {
    const [agent] = await db()
      .insert(t.agents)
      .values({
        workspaceId,
        name: `Agent ${seq++}`,
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'Review.',
        enabled: opts.enabled ?? true,
        version: 3,
      })
      .returning();
    if (opts.linkSkillId) {
      await db().insert(t.agentSkills).values({ agentId: agent!.id, skillId: opts.linkSkillId, order: 0 });
    }
    return agent!;
  }

  // ---- T4/T5/T6 — table + column exist and cascade (test_skill_suite_persist) ----
  it('eval_skill_suite_runs table + eval_runs.skill_suite_run_id column exist and cascade', async () => {
    const skill = await seedSkill();
    const host = await seedAgent({ linkSkillId: skill.id });
    const suite = await repo.insertSkillSuite({
      workspaceId,
      skillId: skill.id,
      skillVersion: skill.version,
      hostAgentId: host.id,
      hostAgentVersion: host.version,
    });
    const [caseRow] = await db()
      .insert(t.evalCases)
      .values({ workspaceId, ownerKind: 'skill', ownerId: skill.id, name: 'c', inputDiff: 'x', expectedOutput: {} })
      .returning();
    // A skill per-case row sets skill_suite_run_id and leaves suite_run_id NULL
    // (the two suite-parent FKs are mutually exclusive by construction).
    const run = await repo.insertRun({
      caseId: caseRow!.id,
      skillSuiteRunId: suite.id,
      pass: true,
      recall: null,
      precision: null,
      citationAccuracy: null,
      durationMs: 10,
      costUsd: null,
    });
    expect(run.skillSuiteRunId).toBe(suite.id);
    expect(run.suiteRunId).toBeNull();

    // Deleting the skill suite cascades its per-case rows via the new FK.
    await db().delete(t.evalSkillSuiteRuns).where(eq(t.evalSkillSuiteRuns.id, suite.id));
    const rows = await db().select().from(t.evalRuns).where(eq(t.evalRuns.skillSuiteRunId, suite.id));
    expect(rows).toHaveLength(0);
  });

  // ---- T7/T8 — repo method surface (test_skill_suite_repo) ----
  it('insertSuite → running; oneRunningForSkill finds it; setTerminal writes pooled metrics once', async () => {
    const skill = await seedSkill();
    const host = await seedAgent({ linkSkillId: skill.id });
    const suite = await repo.insertSkillSuite({
      workspaceId,
      skillId: skill.id,
      skillVersion: skill.version,
      hostAgentId: host.id,
      hostAgentVersion: host.version,
    });
    expect(suite.status).toBe('running');
    expect(suite.hostAgentId).toBe(host.id);

    const running = await repo.oneRunningForSkill(workspaceId, skill.id);
    expect(running?.id).toBe(suite.id);

    await repo.setSkillSuiteTerminal(suite.id, {
      status: 'done',
      recall: 1,
      precision: 0.5,
      citationAccuracy: null,
      passed: 1,
      total: 2,
      costUsd: 0.002,
      durationMs: 42,
    });
    const done = await repo.getSkillSuite(workspaceId, suite.id);
    expect(done?.status).toBe('done');
    expect(done?.recall).toBe(1);
    expect(done?.precision).toBe(0.5);
    expect(done?.citationAccuracy).toBeNull();
    expect(done?.passed).toBe(1);
    expect(done?.total).toBe(2);
    expect(done?.costUsd).toBeCloseTo(0.002);
    expect(done?.durationMs).toBe(42);

    // Once terminal, it is no longer the running suite.
    expect(await repo.oneRunningForSkill(workspaceId, skill.id)).toBeUndefined();
  });

  it('getSkillSuite is workspace-scoped; listBySkill newest-first; listRecentByWorkspace', async () => {
    const skill = await seedSkill();
    const host = await seedAgent({ linkSkillId: skill.id });
    const mk = () =>
      repo.insertSkillSuite({
        workspaceId,
        skillId: skill.id,
        skillVersion: skill.version,
        hostAgentId: host.id,
        hostAgentVersion: host.version,
      });
    const s1 = await mk();
    const s2 = await mk();

    // Wrong workspace → not found.
    expect(await repo.getSkillSuite('00000000-0000-0000-0000-000000000000', s1.id)).toBeUndefined();

    const bySkill = await repo.listSkillSuitesBySkill(workspaceId, skill.id, 10);
    expect(bySkill.map((r) => r.id)).toEqual(expect.arrayContaining([s1.id, s2.id]));
    // Newest-first ordering: s2 precedes s1.
    expect(bySkill.findIndex((r) => r.id === s2.id)).toBeLessThan(
      bySkill.findIndex((r) => r.id === s1.id),
    );

    const recent = await repo.listRecentSkillSuites(workspaceId, 50);
    expect(recent.some((r) => r.id === s1.id)).toBe(true);
    expect(recent.some((r) => r.id === s2.id)).toBe(true);
  });

  it('reapStaleRunningSkillSuites flips running → failed; deleteSkillSuitesBySkill removes', async () => {
    const skill = await seedSkill();
    const host = await seedAgent({ linkSkillId: skill.id });
    const suite = await repo.insertSkillSuite({
      workspaceId,
      skillId: skill.id,
      skillVersion: skill.version,
      hostAgentId: host.id,
      hostAgentVersion: host.version,
    });

    const reaped = await repo.reapStaleRunningSkillSuites();
    expect(reaped).toBeGreaterThanOrEqual(1);
    const afterReap = await repo.getSkillSuite(workspaceId, suite.id);
    expect(afterReap?.status).toBe('failed');
    expect(await repo.oneRunningForSkill(workspaceId, skill.id)).toBeUndefined();

    const removed = await repo.deleteSkillSuitesBySkill(workspaceId, skill.id);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await repo.getSkillSuite(workspaceId, suite.id)).toBeUndefined();
  });

  it('listRunsBySkillSuite returns only that skill-suite\'s per-case rows, newest-first', async () => {
    const skill = await seedSkill();
    const host = await seedAgent({ linkSkillId: skill.id });
    const suite = await repo.insertSkillSuite({
      workspaceId,
      skillId: skill.id,
      skillVersion: skill.version,
      hostAgentId: host.id,
      hostAgentVersion: host.version,
    });
    const [c1] = await db()
      .insert(t.evalCases)
      .values({ workspaceId, ownerKind: 'skill', ownerId: skill.id, name: 'c1', inputDiff: 'x', expectedOutput: {} })
      .returning();
    const [c2] = await db()
      .insert(t.evalCases)
      .values({ workspaceId, ownerKind: 'skill', ownerId: skill.id, name: 'c2', inputDiff: 'x', expectedOutput: {} })
      .returning();

    const base = {
      pass: true as const,
      recall: null,
      precision: null,
      citationAccuracy: null,
      durationMs: 1,
      costUsd: null,
    };
    await repo.insertRun({ caseId: c1!.id, skillSuiteRunId: suite.id, ...base });
    await repo.insertRun({ caseId: c2!.id, skillSuiteRunId: suite.id, ...base });
    // A row on a DIFFERENT parent (agent suite) must NOT leak into this read.
    const [agentSuite] = await db()
      .insert(t.evalSuiteRuns)
      .values({ workspaceId, agentId: host.id, agentVersion: host.version, status: 'running' })
      .returning();
    await repo.insertRun({ caseId: c1!.id, suiteRunId: agentSuite!.id, ...base });

    const runs = await repo.listRunsBySkillSuite(suite.id);
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.skillSuiteRunId === suite.id)).toBe(true);
    expect(runs.every((r) => r.suiteRunId === null)).toBe(true);
  });

  // ---- T9 — host candidates + skill reads (test_host_candidates) ----
  it('listEnabledLinkingSkill returns only enabled agents that link the skill, insertion order', async () => {
    const skill = await seedSkill();
    const enabledLinkingA = await seedAgent({ enabled: true, linkSkillId: skill.id });
    const enabledLinkingB = await seedAgent({ enabled: true, linkSkillId: skill.id });
    await seedAgent({ enabled: false, linkSkillId: skill.id }); // disabled → excluded
    await seedAgent({ enabled: true }); // enabled but does NOT link → excluded

    const hosts = await agentsRepo.listEnabledLinkingSkill(workspaceId, skill.id);
    const ids = hosts.map((a) => a.id);
    expect(ids).toEqual([enabledLinkingA.id, enabledLinkingB.id]);
    expect(hosts.every((a) => a.enabled)).toBe(true);
  });

  it('getSkill is workspace-scoped; getSkillVersionBody reads snapshotted body (undefined when missing)', async () => {
    const skill = await seedSkill({ version: 4, body: 'v4 body' });

    const got = await repo.getSkill(workspaceId, skill.id);
    expect(got?.id).toBe(skill.id);
    expect(got?.body).toBe('v4 body');
    // Wrong workspace → undefined.
    expect(await repo.getSkill('00000000-0000-0000-0000-000000000000', skill.id)).toBeUndefined();

    expect(await repo.getSkillVersionBody(skill.id, 4)).toBe('v4 body');
    // A version that was never snapshotted → undefined ("body unavailable").
    expect(await repo.getSkillVersionBody(skill.id, 99)).toBeUndefined();
  });
});
