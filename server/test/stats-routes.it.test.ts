/**
 * Stats endpoints (integration) — `GET /agents/performance`, `/agents/:id/stats`,
 * `/skills/:id/stats`. Exercises the real Drizzle reads + pure aggregation over a
 * seeded Postgres, covering AC-1/2/3/4/9/21/29/34/35.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import type { Db } from '../src/db/client.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

/** Insert one run (+optional trace) and return its id. */
async function insertRun(
  db: Db,
  workspaceId: string,
  over: Partial<typeof t.agentRuns.$inferInsert> & { skillNames?: string[]; memory?: string[] } = {},
): Promise<string> {
  const { skillNames, memory, ...runOver } = over;
  const [run] = await db
    .insert(t.agentRuns)
    .values({
      workspaceId,
      ranAt: new Date(),
      source: 'local',
      costUsd: 0.04,
      durationMs: 6000,
      tokensIn: 100,
      tokensOut: 50,
      findingsCount: 0,
      ...runOver,
    })
    .returning();
  if (skillNames || memory) {
    await db.insert(t.runTraces).values({
      runId: run!.id,
      trace: {
        prompt_assembly: {
          system: 's',
          user: 'u',
          skill_tokens: (skillNames ?? []).map((name) => ({ name, tokens: 10 })),
        },
        memory_pulled: (memory ?? []).map((text) => ({ text })),
      },
    });
  }
  return run!.id;
}

/** Attach a review + one finding to a run. */
async function insertFinding(
  db: Db,
  workspaceId: string,
  prId: string,
  agentId: string,
  runId: string,
  over: { severity?: string; category?: string; acceptedAt?: Date | null; dismissedAt?: Date | null } = {},
): Promise<void> {
  const [review] = await db
    .insert(t.reviews)
    .values({ workspaceId, prId, agentId, runId, kind: 'review' })
    .returning();
  await db.insert(t.findings).values({
    reviewId: review!.id,
    file: 'a.ts',
    startLine: 1,
    endLine: 2,
    severity: over.severity ?? 'WARNING',
    category: over.category ?? 'bug',
    title: 'x',
    rationale: 'y',
    confidence: 0.9,
    acceptedAt: over.acceptedAt ?? null,
    dismissedAt: over.dismissedAt ?? null,
  });
}

d('Stats endpoints (integration)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let agentId: string;
  let skillId: string;
  let prId: string;

  beforeAll(async () => {
    pg = await startPg();
    const { db } = pg.handle;
    ({ workspaceId } = await seed(db));

    const [agent] = await db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Security Reviewer')));
    agentId = agent!.id;

    const [skill] = await db
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, 'pr-quality-rubric')));
    skillId = skill!.id;

    // A repo + PR so findings can reference a real pr_id.
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'w', fullName: 'acme/w' })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 7,
        title: 'p',
        author: 'a',
        branch: 'feat',
        base: 'main',
        headSha: 'abc123',
      })
      .returning();
    prId = pr!.id;

    // Two priced runs for the agent: one local (accepted finding, pulled the skill),
    // one CI (dismissed finding). A third run has a MALFORMED trace (AC-9).
    const r1 = await insertRun(db, workspaceId, {
      agentId,
      prId,
      source: 'local',
      model: 'gpt-x',
      findingsCount: 1,
      skillNames: ['pr-quality-rubric'],
      memory: ['raw-body parser integration'],
    });
    const r2 = await insertRun(db, workspaceId, {
      agentId,
      prId,
      source: 'ci',
      model: 'gpt-x',
      prNumber: 7,
      findingsCount: 1,
    });
    await insertRun(db, workspaceId, { agentId, prId, source: 'local', costUsd: null });
    // Malformed trace document → must degrade, not throw (AC-9).
    const rBad = await insertRun(db, workspaceId, { agentId, prId, source: 'local' });
    await db.insert(t.runTraces).values({ runId: rBad, trace: { prompt_assembly: 'nonsense' } });

    await insertFinding(db, workspaceId, prId, agentId, r1, {
      severity: 'CRITICAL',
      category: 'security',
      acceptedAt: new Date(),
    });
    await insertFinding(db, workspaceId, prId, agentId, r2, {
      severity: 'WARNING',
      category: 'bug',
      dismissedAt: new Date(),
    });
  });

  afterAll(async () => {
    await pg?.stop();
  });

  async function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    // NOTE: NO llm override — the stats path must never construct/call an LLM (AC-1).
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  it('never constructs/calls an LLM or embedder adapter across all three stats endpoints (AC-1)', async () => {
    const app = await makeApp();
    // Spy on the REAL container's adapter factories (no override supplied for
    // llm/embedder in makeApp) — if any stats code path resolved a provider,
    // these would be invoked (and, since no API key is configured for test,
    // would also throw — so a spurious call would surface as a 500 too).
    const llmSpy = vi.spyOn(app.container, 'llm');
    const embedderSpy = vi.spyOn(app.container, 'embedder');

    const [perf, agentStats, skillStats] = await Promise.all([
      app.inject({ method: 'GET', url: '/agents/performance' }),
      app.inject({ method: 'GET', url: `/agents/${agentId}/stats` }),
      app.inject({ method: 'GET', url: `/skills/${skillId}/stats` }),
    ]);

    expect(perf.statusCode).toBe(200);
    expect(agentStats.statusCode).toBe(200);
    expect(skillStats.statusCode).toBe(200);
    expect(llmSpy).not.toHaveBeenCalled();
    expect(embedderSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it('GET /agents/performance returns an AgentPerf with rows + cost breakdowns, both sources (AC-11/35)', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/agents/performance' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary.runs).toBeGreaterThanOrEqual(4); // local + ci + unpriced + malformed
    expect(Array.isArray(body.agents)).toBe(true);
    const row = body.agents.find((r: { agent_id: string }) => r.agent_id === agentId);
    expect(row).toBeTruthy();
    expect(row.accept_rate).toBeCloseTo(0.5); // 1 accepted / 1 dismissed
    expect(body.cost_by_agent.length).toBeGreaterThan(0);
    expect(body.cost_by_model.some((s: { label: string }) => s.label === 'gpt-x')).toBe(true);
    await app.close();
  });

  it('GET /agents/:id/stats returns the extended AgentStats; trace panels degrade, run history badged (AC-9/21/27/35)', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/agents/${agentId}/stats` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.agent_id).toBe(agentId);
    expect(body.accept_rate).toBeCloseTo(0.5);
    // the well-formed trace contributes; the malformed one degrades (no throw).
    expect(body.most_used_skills.some((s: { name: string }) => s.name === 'pr-quality-rubric')).toBe(
      true,
    );
    const sources = body.run_history.map((r: { source: string }) => r.source);
    expect(sources).toContain('local');
    expect(sources).toContain('ci');
    await app.close();
  });

  it('GET /skills/:id/stats returns a SkillStats over the pulled-the-skill subset (AC-29/31)', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/skills/${skillId}/stats` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.skill_id).toBe(skillId);
    expect(body.used_by_agents).toBeGreaterThanOrEqual(1);
    expect(body.pull_frequency).toBeGreaterThan(0);
    expect(body.agents.some((a: { agent_id: string }) => a.agent_id === agentId)).toBe(true);
    await app.close();
  });

  it('rejects an invalid custom range with 422 and computes nothing (AC-4)', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'GET',
      url: '/agents/performance?from=2026-07-10T00:00:00Z&to=2026-07-01T00:00:00Z',
    });
    expect(res.statusCode).toBe(422); // zod type-provider validation → 422
    await app.close();
  });

  it('the dashboard row equals the per-agent Stats tab for the same agent+period (AC-34 parity)', async () => {
    const app = await makeApp();
    const [perf, stats] = await Promise.all([
      app.inject({ method: 'GET', url: '/agents/performance' }),
      app.inject({ method: 'GET', url: `/agents/${agentId}/stats` }),
    ]);
    const row = perf.json().agents.find((r: { agent_id: string }) => r.agent_id === agentId);
    const tab = stats.json();
    expect(row.accept_rate).toBe(tab.accept_rate);
    expect(row.total_cost_usd).toBeCloseTo(tab.total_cost_usd);
    expect(row.findings_by_severity).toEqual(tab.findings_by_severity);
    await app.close();
  });

  it('scopes to the active workspace — a foreign workspace sees no data (AC-2)', async () => {
    const { db } = pg.handle;
    // A second workspace with its own agent + run must not leak into the default one.
    const [ws2] = await db.insert(t.workspaces).values({ name: 'other' }).returning();
    await db
      .insert(t.agentRuns)
      .values({ workspaceId: ws2!.id, source: 'local', costUsd: 5.0, model: 'foreign' });
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/agents/performance' });
    const body = res.json();
    expect(body.cost_by_model.some((s: { label: string }) => s.label === 'foreign')).toBe(false);
    await app.close();
  });
});
