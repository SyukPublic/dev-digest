/**
 * Phase 9 (T21) — integration & measurement (test_multi_run_measurement).
 *
 *  - AC-29: the SSE RunBus REPLAYS its buffered log to a LATE / reconnecting
 *    subscriber, THEN streams live events, THEN ends on completion — proven
 *    end-to-end through `streamRunEvents` (no Docker; reuses the real RunBus).
 *  - AC-30: a completed run's trace carries per-prompt-block token counts
 *    (`prompt_assembly.tokens.system/user`) AND the per-call cost (`stats.cost_usd`)
 *    — so "why did this finding cost this much" is answerable from the trace.
 *  - AC-33: per-finding cost is derivable (a priced run's `cost_usd` / its findings
 *    count).
 *  - AC-32: "1 vs 3" — with a deterministic per-call LLM delay, a 3-agent multi-run's
 *    `total_duration_ms` ≈ the slowest single agent (the aggregate is MAX per-agent,
 *    NOT the SUM), while `total_cost_usd` ≈ 3× a single agent (the aggregate is the
 *    SUM of priced runs). The measured numbers are logged for the run ledger.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import {
  MockLLMProvider,
  MockEmbedder,
  MockGitClient,
  type MockLLMOptions,
} from '../src/adapters/mocks.js';
import { RunBus, streamRunEvents } from '../src/platform/sse.js';
import * as t from '../src/db/schema.js';
import type {
  MultiAgentRun,
  Review,
  RunTrace,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** A diff touching src/config.ts line 11 so each agent grounds exactly one finding. */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** One CRITICAL finding on the changed line — grounds to a single kept finding. */
const FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded secret.',
  score: 40,
  findings: [
    {
      id: 'm-1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live key is committed.',
      confidence: 0.95,
      kind: 'finding',
    },
  ],
};

/** The per-call cost every mock LLM structured call bills (see MockLLMProvider). */
const MOCK_CALL_COST = 0.001;
/** Deterministic per-review latency injected into the LLM (dominates DB overhead). */
const DELAY_MS = 300;

/**
 * A mock LLM that adds a fixed latency to the AGENT REVIEW call only
 * (`schemaName === 'Review'`). The shared intent-classification call is left
 * instant so the wall-clock "1 vs 3" signal reflects only the fan-out, not the
 * once-per-run pre-work. Everything else mirrors `MockLLMProvider`.
 */
class DelayedReviewLLM extends MockLLMProvider {
  constructor(
    id: 'openai' | 'anthropic',
    opts: MockLLMOptions,
    private readonly delayMs: number,
  ) {
    super(id, opts);
  }
  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    if (req.schemaName === 'Review') {
      await new Promise((r) => setTimeout(r, this.delayMs));
    }
    return super.completeStructured(req);
  }
}

// ---------------------------------------------------------------------------
// AC-29 — RunBus replay-then-live-then-done for a LATE / reconnecting subscriber.
// Pure (no Docker); reuses the real RunBus + streamRunEvents bridge.
// ---------------------------------------------------------------------------
describe('SSE RunBus — late/reconnecting subscriber (AC-29)', () => {
  function payload(frame: { data: string }) {
    return JSON.parse(frame.data) as { msg: string; kind: string };
  }

  it('replays the buffer, then streams live, then ends on done', async () => {
    const bus = new RunBus();
    const runId = 'late-1';

    // Events published BEFORE anyone subscribes (the run is already mid-flight).
    bus.publish(runId, 'info', 'boot');
    bus.publish(runId, 'tool', 'loading diff');

    // A LATE subscriber connects now — it must still see the buffered replay.
    const gen = streamRunEvents(bus, runId);
    const f1 = await gen.next();
    const f2 = await gen.next();
    expect(payload(f1.value!).msg).toBe('boot');
    expect(payload(f2.value!).msg).toBe('loading diff');

    // …then a LIVE event published after it attached.
    const pendingLive = gen.next();
    bus.publish(runId, 'result', 'review persisted');
    const f3 = await pendingLive;
    expect(payload(f3.value!).msg).toBe('review persisted');

    // …then completion ends the stream.
    const pendingEnd = gen.next();
    bus.complete(runId);
    const end = await pendingEnd;
    expect(end.done).toBe(true);
    expect(end.value).toBeUndefined();
  });

  it('a subscriber reconnecting AFTER completion still replays the buffer then ends', async () => {
    const bus = new RunBus();
    const runId = 'reconnect-1';
    bus.publish(runId, 'info', 'first');
    bus.publish(runId, 'info', 'second');
    bus.complete(runId); // run finished; buffer is kept for late readers.

    // A brand-new EventSource attaches AFTER the run is already complete.
    const gen = streamRunEvents(bus, runId);
    const seen: string[] = [];
    for await (const frame of gen) seen.push(JSON.parse(frame.data).msg);

    // It got the full buffered replay, then the generator ended (onDone fired
    // immediately for the already-completed run) instead of hanging forever.
    expect(seen).toEqual(['first', 'second']);
  });
});

// ---------------------------------------------------------------------------
// AC-30 / AC-32 / AC-33 — trace token/cost surfacing + the "1 vs 3" measurement.
// Docker-gated (Testcontainers Postgres; migration 0023 gives the grouping FK).
// ---------------------------------------------------------------------------
const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

let seq = 0;
async function setupPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `mrm-${seq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 7,
      title: 'Measurement PR',
      author: 'dev',
      branch: 'feat/m',
      base: 'main',
      headSha: `sha-${seq}`,
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return pr!;
}

async function makeAgent(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  name: string,
): Promise<string> {
  const [agent] = await db
    .insert(t.agents)
    .values({ workspaceId, name, provider: 'openai', model: 'gpt-4.1', systemPrompt: 'review this' })
    .returning({ id: t.agents.id });
  return agent!.id;
}

d('multi-run measurement (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function app() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        // Every agent is `openai` → one shared delayed mock; each call is
        // independent (its own setTimeout), so parallel agents truly overlap.
        llm: { openai: new DelayedReviewLLM('openai', { structured: FIXTURE }, DELAY_MS) },
      },
    });
  }

  /** Launch `n` agents over a fresh PR, wait for the fan-out, read the multi-run. */
  async function launchAndRead(
    n: number,
  ): Promise<{ run: MultiAgentRun; runId: string; wallMs: number }> {
    const server = await app();
    try {
      const pr = await setupPr(pg.handle.db, workspaceId);
      const agentIds: string[] = [];
      for (let i = 0; i < n; i++) {
        agentIds.push(await makeAgent(pg.handle.db, workspaceId, `M${seq}-${i}`));
      }

      const t0 = Date.now();
      const launch = await server.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agent_ids: agentIds },
      });
      expect(launch.statusCode).toBe(200);
      const ack = launch.json();
      await waitForPrRuns(pg.handle.db, pr.id, { expected: n });
      const wallMs = Date.now() - t0;

      const view = await server.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent` });
      expect(view.statusCode).toBe(200);
      return { run: view.json() as MultiAgentRun, runId: ack.runs[0].run_id as string, wallMs };
    } finally {
      await server.close();
    }
  }

  // ---- AC-30 / AC-33: trace token counts + per-call & per-finding cost --------

  it('a completed run trace carries per-block token counts and per-call cost (AC-30/33)', async () => {
    const server = await app();
    try {
      const pr = await setupPr(pg.handle.db, workspaceId);
      const agentId = await makeAgent(pg.handle.db, workspaceId, `Trace-${seq}`);

      const launch = await server.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agent_ids: [agentId] },
      });
      const runId = launch.json().runs[0].run_id as string;
      await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

      const traceRes = await server.inject({ method: 'GET', url: `/runs/${runId}/trace` });
      expect(traceRes.statusCode).toBe(200);
      const trace = traceRes.json() as RunTrace;

      // AC-30: per-prompt-block token counts are present in the trace.
      expect(trace.prompt_assembly.tokens).toBeDefined();
      expect(typeof trace.prompt_assembly.tokens!.system).toBe('number');
      expect(trace.prompt_assembly.tokens!.system).toBeGreaterThan(0);
      expect(typeof trace.prompt_assembly.tokens!.user).toBe('number');

      // AC-30: the per-call cost is on the trace stats.
      expect(trace.stats.cost_usd).toBeCloseTo(MOCK_CALL_COST, 5);
      expect(trace.stats.findings).toBe(1);

      // AC-33: per-finding cost is DERIVABLE from the persisted numbers.
      const view = await server.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent` });
      const run = view.json() as MultiAgentRun;
      const col = run.columns[0]!;
      expect(col.cost_usd).toBeCloseTo(MOCK_CALL_COST, 5);
      expect(col.findings.length).toBe(1);
      const perFindingCost = col.cost_usd! / col.findings.length;
      expect(perFindingCost).toBeCloseTo(MOCK_CALL_COST, 5);
    } finally {
      await server.close();
    }
  });

  // ---- AC-32: "1 vs 3" — duration ≈ MAX (parallel), cost ≈ SUM (~3×) ----------

  it('1 vs 3 — total duration ≈ MAX per-agent (parallel), total cost ≈ SUM (~3×) (AC-32)', async () => {
    const single = await launchAndRead(1);
    const three = await launchAndRead(3);

    expect(single.run.agent_count).toBe(1);
    expect(three.run.agent_count).toBe(3);

    // --- Cost: the aggregate is the SUM of priced runs → ~3× a single agent. ---
    expect(single.run.total_cost_usd).toBeCloseTo(MOCK_CALL_COST, 4); // ≈ 0.001
    expect(three.run.total_cost_usd).toBeCloseTo(MOCK_CALL_COST * 3, 4); // ≈ 0.003
    expect(three.run.total_cost_usd! / single.run.total_cost_usd!).toBeCloseTo(3, 1);
    // It equals the SUM of the individual column costs (not something else).
    const summedCost = sum(three.run.columns.map((c) => c.cost_usd ?? 0));
    expect(three.run.total_cost_usd).toBeCloseTo(summedCost, 6);

    // --- Duration: the aggregate is the MAX per-agent, NOT the SUM. ---
    const colDurations = three.run.columns.map((c) => c.duration_ms ?? 0);
    const maxCol = Math.max(...colDurations);
    const sumCol = sum(colDurations);
    // Each agent actually paid the injected delay.
    for (const dms of colDurations) expect(dms).toBeGreaterThanOrEqual(DELAY_MS - 30);
    // Aggregate == MAX per-agent (definition), and strictly below the SUM of 3.
    expect(three.run.total_duration_ms).toBe(maxCol);
    expect(three.run.total_duration_ms).toBeLessThan(sumCol);
    expect(three.run.total_duration_ms).toBeLessThan(sumCol * 0.6); // ≈ SUM/3, comfortably under
    // 3-agent total duration ≈ a single agent's — it does NOT scale with N.
    expect(three.run.total_duration_ms).toBeLessThan(single.run.total_duration_ms * 2);

    // --- Wall-clock corroboration: 3 agents fan out in parallel, so the launch
    //     wall time is nowhere near 3× the single-agent launch (the review delay
    //     is paid once concurrently, not three times sequentially). ---
    expect(three.wallMs).toBeLessThan(single.wallMs * 2);

    // Record the deterministic "1 vs 3" figures for the run ledger.
    // eslint-disable-next-line no-console
    console.log(
      `[AC-32 1 vs 3] single: total_duration=${single.run.total_duration_ms}ms ` +
        `cost=$${single.run.total_cost_usd} (wall ${single.wallMs}ms) | ` +
        `three: total_duration=${three.run.total_duration_ms}ms (MAX; SUM would be ${sumCol}ms) ` +
        `cost=$${three.run.total_cost_usd} (wall ${three.wallMs}ms) | ` +
        `cost ratio ≈ ${(three.run.total_cost_usd! / single.run.total_cost_usd!).toFixed(2)}×, ` +
        `duration ratio ≈ ${(three.run.total_duration_ms / single.run.total_duration_ms).toFixed(2)}×`,
    );
  });
});

function sum(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0);
}
