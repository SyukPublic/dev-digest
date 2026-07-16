/**
 * Phase 4 (T6 + T7) — multi-agent run persistence + estimate repo round-trips
 * (Testcontainers Postgres; migration 0023 gives `agent_runs.multi_agent_run_id`).
 *
 * test_multi_run_repo (AC-11, AC-12, AC-27): createMultiRun + grouped read-back —
 *   agent_count / MAX duration / SUM priced cost derivable, findings attributed
 *   per agent (run → review → findings), latest-wins, workspace scoping.
 * test_agent_estimates (AC-5, AC-6): per-agent averages over done runs, nullable
 *   averages, sample_size, done-only, agentIds filter, workspace scoping.
 */

import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import * as t from '../src/db/schema.js';
import type { Finding } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

let seq = 0;
async function setupPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `mar-${seq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 1,
      title: 'Multi-agent PR',
      author: 'dev',
      branch: 'feat/x',
      base: 'main',
      headSha: `sha-${seq}`,
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
    })
    .returning();
  return pr!;
}

async function makeAgent(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  name: string,
): Promise<string> {
  const [agent] = await db
    .insert(t.agents)
    .values({
      workspaceId,
      name,
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'rev',
    })
    .returning({ id: t.agents.id });
  return agent!.id;
}

function finding(file: string, line: number, severity = 'WARNING'): Finding {
  return {
    id: randomUUID(),
    severity: severity as Finding['severity'],
    category: 'bug',
    title: `Issue in ${file}`,
    file,
    start_line: line,
    end_line: line,
    rationale: 'because',
    confidence: 0.8,
    kind: 'finding',
  };
}

d('multi-agent run repo (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repo: ReviewRepository;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    repo = new ReviewRepository(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  // ---- T6: createMultiRun + grouped read-back ----------------------------

  it('getLatestMultiRun returns undefined for a PR with no multi-run', async () => {
    const pr = await setupPr(pg.handle.db, workspaceId);
    expect(await repo.getLatestMultiRun(workspaceId, pr.id)).toBeUndefined();
  });

  it('groups runs, joins agent name, attributes findings per agent (AC-11/12/27)', async () => {
    const pr = await setupPr(pg.handle.db, workspaceId);
    const agentA = await makeAgent(pg.handle.db, workspaceId, 'Alpha');
    const agentB = await makeAgent(pg.handle.db, workspaceId, 'Beta');

    const multiRunId = await repo.createMultiRun(workspaceId, pr.id);
    expect(multiRunId).toBeTruthy();

    const batchId = randomUUID();

    // Agent A: done, duration 500, cost 0.02, one finding in a.ts.
    const runA = await repo.createAgentRun({
      workspaceId,
      agentId: agentA,
      prId: pr.id,
      provider: 'openai',
      model: 'gpt-4.1',
      batchId,
      multiAgentRunId: multiRunId,
    });
    await repo.completeAgentRun(runA, {
      status: 'done',
      durationMs: 500,
      tokensIn: 10,
      tokensOut: 20,
      findingsCount: 1,
      grounding: '1/1 passed',
      costUsd: 0.02,
      score: 80,
    });
    const reviewA = await repo.insertReview({
      workspaceId,
      prId: pr.id,
      agentId: agentA,
      runId: runA,
      kind: 'review',
      verdict: 'comment',
      summary: 'A summary',
      score: 80,
      model: 'gpt-4.1',
    });
    await repo.insertFindings(reviewA.id, [finding('a.ts', 11)]);
    // A stray kind='summary' review for the same run must be ignored on read.
    await repo.insertReview({
      workspaceId,
      prId: pr.id,
      agentId: agentA,
      runId: runA,
      kind: 'summary',
      verdict: null,
      summary: 'map-reduce summary',
      score: null,
      model: 'gpt-4.1',
    });

    // Agent B: done, duration 1200 (the MAX), cost null (unpriced), two findings.
    const runB = await repo.createAgentRun({
      workspaceId,
      agentId: agentB,
      prId: pr.id,
      provider: 'openai',
      model: 'gpt-4.1',
      batchId,
      multiAgentRunId: multiRunId,
    });
    await repo.completeAgentRun(runB, {
      status: 'done',
      durationMs: 1200,
      tokensIn: 5,
      tokensOut: 5,
      findingsCount: 2,
      grounding: '2/2 passed',
      costUsd: null,
      score: 60,
    });
    const reviewB = await repo.insertReview({
      workspaceId,
      prId: pr.id,
      agentId: agentB,
      runId: runB,
      kind: 'review',
      verdict: 'request_changes',
      summary: 'B summary',
      score: 60,
      model: 'gpt-4.1',
    });
    await repo.insertFindings(reviewB.id, [finding('b.ts', 3), finding('b.ts', 9)]);

    const latest = await repo.getLatestMultiRun(workspaceId, pr.id);
    expect(latest).toBeDefined();
    expect(latest!.id).toBe(multiRunId);
    expect(latest!.prId).toBe(pr.id);
    expect(latest!.agents).toHaveLength(2);

    const byName = Object.fromEntries(latest!.agents.map((a) => [a.agentName, a]));
    expect(Object.keys(byName).sort()).toEqual(['Alpha', 'Beta']);

    // Attribution (AC-27): each run carries only its own review + findings.
    const a = byName['Alpha']!;
    expect(a.review?.kind).toBe('review');
    expect(a.review?.verdict).toBe('comment');
    expect(a.findings.map((f) => f.file)).toEqual(['a.ts']);
    expect(a.run.costUsd).toBe(0.02);
    expect(a.run.durationMs).toBe(500);

    const b = byName['Beta']!;
    expect(b.review?.verdict).toBe('request_changes');
    expect(b.findings).toHaveLength(2);
    expect(b.findings.every((f) => f.file === 'b.ts')).toBe(true);
    expect(b.run.costUsd).toBeNull();

    // Aggregates are derivable on read (AC-11): count / MAX duration / SUM priced.
    const durations = latest!.agents.map((x) => x.run.durationMs ?? 0);
    const pricedCost = latest!.agents
      .map((x) => x.run.costUsd)
      .filter((c): c is number => c != null);
    expect(latest!.agents.length).toBe(2); // agent_count
    expect(Math.max(...durations)).toBe(1200); // total_duration_ms
    expect(pricedCost.reduce((s, c) => s + c, 0)).toBeCloseTo(0.02); // total_cost_usd (priced only)
  });

  it('returns the latest multi-run when a PR has several (AC-12)', async () => {
    const pr = await setupPr(pg.handle.db, workspaceId);
    // Older group inserted directly with a past ran_at for a deterministic order.
    const [older] = await pg.handle.db
      .insert(t.multiAgentRuns)
      .values({ workspaceId, prId: pr.id, ranAt: new Date('2020-01-01T00:00:00Z') })
      .returning({ id: t.multiAgentRuns.id });
    const newer = await repo.createMultiRun(workspaceId, pr.id);

    const latest = await repo.getLatestMultiRun(workspaceId, pr.id);
    expect(latest!.id).toBe(newer);
    expect(latest!.id).not.toBe(older!.id);
  });

  it('is workspace-scoped: another workspace cannot read the group', async () => {
    const pr = await setupPr(pg.handle.db, workspaceId);
    await repo.createMultiRun(workspaceId, pr.id);
    const otherWs = randomUUID();
    await pg.handle.db.insert(t.workspaces).values({ id: otherWs, name: 'Other' });
    expect(await repo.getLatestMultiRun(otherWs, pr.id)).toBeUndefined();
  });

  // ---- T7: agentRunEstimates ---------------------------------------------

  it('averages done runs, nulls with no priced data, sample_size, filters (AC-5/6)', async () => {
    const pr = await setupPr(pg.handle.db, workspaceId);
    const agentA = await makeAgent(pg.handle.db, workspaceId, 'EstA');
    const agentB = await makeAgent(pg.handle.db, workspaceId, 'EstB');
    const agentC = await makeAgent(pg.handle.db, workspaceId, 'EstC');
    const batchId = randomUUID();

    // Agent A: 3 done runs, durations 100/200/300, costs 0.01/0.03/null.
    await pg.handle.db.insert(t.agentRuns).values([
      { workspaceId, agentId: agentA, prId: pr.id, status: 'done', durationMs: 100, costUsd: 0.01, batchId, source: 'local' },
      { workspaceId, agentId: agentA, prId: pr.id, status: 'done', durationMs: 200, costUsd: 0.03, batchId, source: 'local' },
      { workspaceId, agentId: agentA, prId: pr.id, status: 'done', durationMs: 300, costUsd: null, batchId, source: 'local' },
      // Non-done runs must be EXCLUDED from the estimate.
      { workspaceId, agentId: agentA, prId: pr.id, status: 'failed', durationMs: 9999, costUsd: 9.99, batchId, source: 'local' },
      { workspaceId, agentId: agentA, prId: pr.id, status: 'running', durationMs: null, costUsd: null, batchId, source: 'local' },
    ]);
    // Agent B: 1 done run with NO duration and NO cost ⇒ null averages, size 1.
    await pg.handle.db.insert(t.agentRuns).values({
      workspaceId, agentId: agentB, prId: pr.id, status: 'done', durationMs: null, costUsd: null, batchId, source: 'local',
    });
    // Agent C: only a failed run ⇒ absent from the estimate result entirely.
    await pg.handle.db.insert(t.agentRuns).values({
      workspaceId, agentId: agentC, prId: pr.id, status: 'failed', durationMs: 50, costUsd: 0.05, batchId, source: 'local',
    });

    const all = await repo.agentRunEstimates(workspaceId);
    const byId = Object.fromEntries(all.map((r) => [r.agent_id, r]));

    // Agent A: avg duration (100+200+300)/3 = 200; avg cost over priced = 0.02; n=3.
    expect(byId[agentA]).toBeDefined();
    expect(byId[agentA]!.avg_duration_ms).toBeCloseTo(200);
    expect(byId[agentA]!.avg_cost_usd).toBeCloseTo(0.02);
    expect(byId[agentA]!.sample_size).toBe(3);

    // Agent B: no priced/timed data ⇒ nulls (never 0), size 1.
    expect(byId[agentB]!.avg_duration_ms).toBeNull();
    expect(byId[agentB]!.avg_cost_usd).toBeNull();
    expect(byId[agentB]!.sample_size).toBe(1);

    // Agent C: no done runs ⇒ absent (service fills sample_size=0).
    expect(byId[agentC]).toBeUndefined();

    // agentIds filter narrows to the requested agents only.
    const onlyA = await repo.agentRunEstimates(workspaceId, [agentA]);
    expect(onlyA.map((r) => r.agent_id)).toEqual([agentA]);

    // An explicit empty filter returns nothing (no unfiltered scan).
    expect(await repo.agentRunEstimates(workspaceId, [])).toEqual([]);
  });

  it('estimate is workspace-scoped', async () => {
    const otherWs = randomUUID();
    await pg.handle.db.insert(t.workspaces).values({ id: otherWs, name: 'EstOther' });
    const pr = await setupPr(pg.handle.db, otherWs);
    const agent = await makeAgent(pg.handle.db, otherWs, 'ScopedAgent');
    await pg.handle.db.insert(t.agentRuns).values({
      workspaceId: otherWs, agentId: agent, prId: pr.id, status: 'done', durationMs: 42, costUsd: 0.5, batchId: randomUUID(), source: 'local',
    });

    // The other workspace's run must not leak into this workspace's estimate.
    const thisWs = await repo.agentRunEstimates(workspaceId);
    expect(thisWs.some((r) => r.agent_id === agent)).toBe(false);
    // …and is visible when we scope to its own workspace.
    const scoped = await repo.agentRunEstimates(otherWs);
    expect(scoped.find((r) => r.agent_id === agent)?.avg_duration_ms).toBeCloseTo(42);
  });
});
