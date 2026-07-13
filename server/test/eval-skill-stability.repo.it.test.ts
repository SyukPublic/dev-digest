import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { EvalRepository } from '../src/modules/eval/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval-skill-stability.repo] Docker not available — skipping integration tests.');
}

/**
 * Phase 2 (T4–T8) — the stability-layer data layer:
 * `eval_skill_stability_groups` (the group parent), the nullable
 * `eval_skill_suite_runs.stability_group_id` FK, the mirrored
 * `eval-skill-stability.repo` module + facade, and the batched
 * `listRunsBySkillSuites`. Proves the GENERATED migration
 * (`0022_sparkling_rogue.sql`) created the table + column and that the group
 * cascade reaches the child suite runs (and transitively their `eval_runs`).
 * → AC-1, AC-3, AC-5, AC-6, AC-8, AC-9.
 */
d('skill-eval stability data layer (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repo: EvalRepository;
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
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const db = () => pg.handle.db;

  async function seedSkill() {
    const [skill] = await db()
      .insert(t.skills)
      .values({
        workspaceId,
        name: `Skill ${seq++}`,
        description: 'x',
        type: 'custom',
        source: 'manual',
        body: 'body',
        enabled: true,
        version: 1,
      })
      .returning();
    return skill!;
  }

  async function seedAgent() {
    const [agent] = await db()
      .insert(t.agents)
      .values({
        workspaceId,
        name: `Agent ${seq++}`,
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'Review.',
        enabled: true,
        version: 3,
      })
      .returning();
    return agent!;
  }

  function groupValues(skillId: string, hostId: string) {
    return {
      workspaceId,
      skillId,
      skillVersion: 1,
      hostAgentId: hostId,
      hostAgentVersion: 3,
      nRequested: 5,
    };
  }

  // ---- T4/T5/T6 — table + column exist and cascade (test_stability_persist) ----
  it('group table + stability_group_id FK exist; deleting a group cascades child suites AND their per-case rows', async () => {
    const skill = await seedSkill();
    const host = await seedAgent();
    const group = await repo.insertStabilityGroup(groupValues(skill.id, host.id));
    expect(group.status).toBe('running');
    expect(group.nRequested).toBe(5);

    // A child differential suite linked to the group.
    const child = await repo.insertSkillSuite({
      workspaceId,
      skillId: skill.id,
      skillVersion: skill.version,
      hostAgentId: host.id,
      hostAgentVersion: host.version,
      stabilityGroupId: group.id,
    });
    expect(child.stabilityGroupId).toBe(group.id);

    const [caseRow] = await db()
      .insert(t.evalCases)
      .values({ workspaceId, ownerKind: 'skill', ownerId: skill.id, name: 'c', inputDiff: 'x', expectedOutput: {} })
      .returning();
    await repo.insertRun({
      caseId: caseRow!.id,
      skillSuiteRunId: child.id,
      pass: true,
      recall: null,
      precision: null,
      citationAccuracy: null,
      durationMs: 1,
      costUsd: null,
    });

    // Deleting the group cascades its child suite runs, whose per-case rows cascade too.
    await db().delete(t.evalSkillStabilityGroups).where(eq(t.evalSkillStabilityGroups.id, group.id));
    const suites = await db()
      .select()
      .from(t.evalSkillSuiteRuns)
      .where(eq(t.evalSkillSuiteRuns.stabilityGroupId, group.id));
    const runs = await db()
      .select()
      .from(t.evalRuns)
      .where(eq(t.evalRuns.skillSuiteRunId, child.id));
    expect(suites).toHaveLength(0);
    expect(runs).toHaveLength(0);
  });

  it('a STANDALONE differential suite leaves stability_group_id NULL', async () => {
    const skill = await seedSkill();
    const host = await seedAgent();
    const suite = await repo.insertSkillSuite({
      workspaceId,
      skillId: skill.id,
      skillVersion: skill.version,
      hostAgentId: host.id,
      hostAgentVersion: host.version,
    });
    expect(suite.stabilityGroupId).toBeNull();
  });

  // ---- T7 — repo method surface (test_stability_repo) ----
  it('insertGroup → running; oneRunningForSkill finds it; setTerminal flips it', async () => {
    const skill = await seedSkill();
    const host = await seedAgent();
    const group = await repo.insertStabilityGroup(groupValues(skill.id, host.id));

    const running = await repo.oneRunningStabilityGroupForSkill(workspaceId, skill.id);
    expect(running?.id).toBe(group.id);

    await repo.setStabilityGroupTerminal(group.id, 'done');
    const done = await repo.getStabilityGroup(workspaceId, group.id);
    expect(done?.status).toBe('done');
    // No longer the running group.
    expect(await repo.oneRunningStabilityGroupForSkill(workspaceId, skill.id)).toBeUndefined();
  });

  it('getStabilityGroup is workspace-scoped; listBySkill newest-first; listRunsByGroup returns children', async () => {
    const skill = await seedSkill();
    const host = await seedAgent();
    const g1 = await repo.insertStabilityGroup(groupValues(skill.id, host.id));
    const g2 = await repo.insertStabilityGroup(groupValues(skill.id, host.id));

    expect(
      await repo.getStabilityGroup('00000000-0000-0000-0000-000000000000', g1.id),
    ).toBeUndefined();

    const bySkill = await repo.listStabilityGroupsBySkill(workspaceId, skill.id, 10);
    expect(bySkill.findIndex((r) => r.id === g2.id)).toBeLessThan(
      bySkill.findIndex((r) => r.id === g1.id),
    );

    // Two child suites of g1.
    const c1 = await repo.insertSkillSuite({
      workspaceId,
      skillId: skill.id,
      skillVersion: 1,
      hostAgentId: host.id,
      hostAgentVersion: 3,
      stabilityGroupId: g1.id,
    });
    const c2 = await repo.insertSkillSuite({
      workspaceId,
      skillId: skill.id,
      skillVersion: 1,
      hostAgentId: host.id,
      hostAgentVersion: 3,
      stabilityGroupId: g1.id,
    });
    const children = await repo.listRunsByStabilityGroup(g1.id);
    expect(children.map((c) => c.id).sort()).toEqual([c1.id, c2.id].sort());
    // A g2 child must not leak into g1's children.
    await repo.insertSkillSuite({
      workspaceId,
      skillId: skill.id,
      skillVersion: 1,
      hostAgentId: host.id,
      hostAgentVersion: 3,
      stabilityGroupId: g2.id,
    });
    expect(await repo.listRunsByStabilityGroup(g1.id)).toHaveLength(2);
  });

  it('reapStaleRunningStabilityGroups flips running → failed; deleteBySkill removes', async () => {
    const skill = await seedSkill();
    const host = await seedAgent();
    const group = await repo.insertStabilityGroup(groupValues(skill.id, host.id));

    const reaped = await repo.reapStaleRunningStabilityGroups();
    expect(reaped).toBeGreaterThanOrEqual(1);
    expect((await repo.getStabilityGroup(workspaceId, group.id))?.status).toBe('failed');

    const removed = await repo.deleteStabilityGroupsBySkill(workspaceId, skill.id);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await repo.getStabilityGroup(workspaceId, group.id)).toBeUndefined();
  });

  // ---- T8 — batched per-case reads across a group's child suites ----
  it('listRunsBySkillSuites returns per-case rows across a SET of child suites', async () => {
    const skill = await seedSkill();
    const host = await seedAgent();
    const group = await repo.insertStabilityGroup(groupValues(skill.id, host.id));
    const childA = await repo.insertSkillSuite({
      workspaceId, skillId: skill.id, skillVersion: 1, hostAgentId: host.id, hostAgentVersion: 3, stabilityGroupId: group.id,
    });
    const childB = await repo.insertSkillSuite({
      workspaceId, skillId: skill.id, skillVersion: 1, hostAgentId: host.id, hostAgentVersion: 3, stabilityGroupId: group.id,
    });
    const [caseRow] = await db()
      .insert(t.evalCases)
      .values({ workspaceId, ownerKind: 'skill', ownerId: skill.id, name: 'c', inputDiff: 'x', expectedOutput: {} })
      .returning();
    const base = { caseId: caseRow!.id, pass: true as const, recall: null, precision: null, citationAccuracy: null, durationMs: 1, costUsd: null };
    await repo.insertRun({ ...base, skillSuiteRunId: childA.id });
    await repo.insertRun({ ...base, skillSuiteRunId: childB.id });

    const rows = await repo.listRunsBySkillSuites([childA.id, childB.id]);
    expect(rows).toHaveLength(2);
    // empty input → empty result (no unbounded scan)
    expect(await repo.listRunsBySkillSuites([])).toEqual([]);
  });
});
