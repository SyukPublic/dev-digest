/**
 * Phase 5 (T10 + T11) — multi-run service + routes (Testcontainers Postgres;
 * migration 0023 gives `agent_runs.multi_agent_run_id`).
 *
 * test_multi_run_service / test_multi_agent_routes:
 *  - AC-10/36: the launch route CARRIES config.rateLimit {max:10,timeWindow} and
 *    SSE routes carry rateLimit:false (a live 429 is a no-op under tests — server
 *    INSIGHT 2026-07-13 — so we assert the route CONFIG, not a 429); a bad body /
 *    foreign agent id returns the shared error envelope.
 *  - AC-9:  launch validates workspace agents (rejects foreign ids), persists the
 *    grouping + N runs, fire-and-forgets the executor, returns the DEC-F ack.
 *  - AC-11/12/14/22/27: getLatest builds columns + aggregates (count / MAX
 *    duration / SUM priced cost) + on-read conflicts.
 *  - AC-5/6: the estimates endpoint returns one row per workspace agent.
 */

import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { Container } from '../src/platform/container.js';
import reviewsRoutes from '../src/modules/reviews/routes.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** A diff touching src/config.ts line 11 so both agents can ground a finding there. */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** Agent A (openai) flags line 11 CRITICAL. */
const FIXTURE_A: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded secret.',
  score: 40,
  findings: [
    {
      id: 'a-1',
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

/** Agent B (anthropic) flags the SAME line 11 but only as a WARNING → conflict. */
const FIXTURE_B: Review = {
  verdict: 'comment',
  summary: 'Consider externalizing the key.',
  score: 70,
  findings: [
    {
      id: 'b-1',
      severity: 'WARNING',
      category: 'security',
      title: 'Secret should live in an env var',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'Prefer configuration over a literal.',
      confidence: 0.6,
      kind: 'finding',
    },
  ],
};

let seq = 0;
async function setupPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `mrs-${seq++}`;
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
      title: 'Add rate limiting',
      author: 'dev',
      branch: 'feat/rl',
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
  provider: 'openai' | 'anthropic',
  model: string,
  enabled = true,
): Promise<string> {
  const [agent] = await db
    .insert(t.agents)
    .values({ workspaceId, name, provider, model, systemPrompt: 'rev', enabled })
    .returning({ id: t.agents.id });
  return agent!.id;
}

d('multi-run service + routes (Testcontainers pg)', () => {
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
        llm: {
          openai: new MockLLMProvider('openai', { structured: FIXTURE_A }),
          anthropic: new MockLLMProvider('anthropic', { structured: FIXTURE_B }),
        },
      },
    });
  }

  // ---- T11 / AC-36: the routes CARRY their rate-limit config ---------------

  it('the launch route carries config.rateLimit and SSE routes carry rateLimit:false', async () => {
    const bare = Fastify();
    bare.setValidatorCompiler(validatorCompiler);
    bare.setSerializerCompiler(serializerCompiler);
    bare.decorate('container', new Container(config(), pg.handle.db));
    const routes: { method: string | string[]; url: string; config?: { rateLimit?: unknown } }[] =
      [];
    bare.addHook('onRoute', (r) => routes.push({ method: r.method, url: r.url, config: r.config }));
    await bare.register(reviewsRoutes);
    await bare.ready();

    const has = (url: string, method: string) =>
      routes.find(
        (r) =>
          r.url === url &&
          (r.method === method || (Array.isArray(r.method) && r.method.includes(method))),
      );

    const launch = has('/pulls/:id/multi-agent-run', 'POST');
    expect(launch).toBeDefined();
    expect(launch!.config?.rateLimit).toEqual({ max: 10, timeWindow: '1 minute' });

    // The multi-agent read + estimates endpoints exist.
    expect(has('/pulls/:id/multi-agent', 'GET')).toBeDefined();
    expect(has('/agents/estimates', 'GET')).toBeDefined();

    // SSE stays rateLimit:false (long-lived connection, not burst traffic).
    expect(has('/runs/:id/events', 'GET')!.config?.rateLimit).toBe(false);

    await bare.close();
  });

  // ---- T10 / AC-9: reject foreign / unknown agent ids ---------------------

  it('rejects a foreign agent id with the shared error envelope (404)', async () => {
    const server = await app();
    const pr = await setupPr(pg.handle.db, workspaceId);

    const res = await server.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: [randomUUID()] },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');

    await server.close();
  });

  it('rejects an empty agent_ids body with a validation envelope (422)', async () => {
    const server = await app();
    const pr = await setupPr(pg.handle.db, workspaceId);

    const res = await server.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: [] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');

    await server.close();
  });

  // ---- T10 / AC-9/11/12/14/22/27: launch → getLatest ----------------------

  it('launches N agents, then getLatest builds columns + aggregates + conflicts', async () => {
    const server = await app();
    const pr = await setupPr(pg.handle.db, workspaceId);
    const agentA = await makeAgent(pg.handle.db, workspaceId, 'SecCrit', 'openai', 'gpt-4.1');
    const agentB = await makeAgent(pg.handle.db, workspaceId, 'SecWarn', 'anthropic', 'claude-x');

    // Launch — DEC-F ack shape.
    const launch = await server.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: [agentA, agentB] },
    });
    expect(launch.statusCode).toBe(200);
    const ack = launch.json();
    expect(ack.pr_id).toBe(pr.id);
    expect(ack.multi_run_id).toBeTruthy();
    expect(ack.runs).toHaveLength(2);
    for (const run of ack.runs) {
      expect(run.run_id).toBeTruthy();
      expect([agentA, agentB]).toContain(run.agent_id);
      expect(run.agent_name).toBeTruthy();
    }

    // Wait for the fire-and-forget parallel runs to settle.
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });

    // Read the assembled multi-run.
    const view = await server.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent` });
    expect(view.statusCode).toBe(200);
    const mar = view.json();
    expect(mar.id).toBe(ack.multi_run_id);
    expect(mar.pr_id).toBe(pr.id);
    expect(mar.pr_number).toBe(7);

    // Aggregates ON READ (AC-11/14).
    expect(mar.agent_count).toBe(2);
    expect(typeof mar.total_duration_ms).toBe('number');
    // Two priced mock calls @ $0.001 each ⇒ SUM ≈ 0.002.
    expect(mar.total_cost_usd).toBeCloseTo(0.002);

    // Columns (one per agent), each with its attributed finding (AC-27).
    expect(mar.columns).toHaveLength(2);
    const byName = Object.fromEntries(mar.columns.map((c: { agent_name: string }) => [c.agent_name, c]));
    expect(byName['SecCrit'].status).toBe('done');
    expect(byName['SecCrit'].findings).toHaveLength(1);
    expect(byName['SecCrit'].findings[0].severity).toBe('CRITICAL');
    expect(byName['SecWarn'].findings[0].severity).toBe('WARNING');

    // On-read conflict: both flagged src/config.ts:11 (security) with divergent
    // severities ⇒ one conflict with a take per agent (AC-22/23).
    expect(mar.conflicts).toHaveLength(1);
    const conflict = mar.conflicts[0];
    expect(conflict.file).toBe('src/config.ts');
    expect(conflict.line).toBe(11);
    expect(conflict.takes).toHaveLength(2);
    expect(conflict.takes.map((tk: { verdict: string }) => tk.verdict).sort()).toEqual([
      'CRITICAL',
      'WARNING',
    ]);

    await server.close();
  });

  it('getLatest returns null when a PR has no multi-agent run', async () => {
    const server = await app();
    const pr = await setupPr(pg.handle.db, workspaceId);
    const view = await server.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent` });
    expect(view.statusCode).toBe(200);
    expect(view.json()).toBeNull();
    await server.close();
  });

  // ---- T10 / AC-5/6: estimates endpoint -----------------------------------

  it('estimates returns one row per workspace agent, filling sample_size=0 for un-run agents', async () => {
    const server = await app();
    const pr = await setupPr(pg.handle.db, workspaceId);
    const ranAgent = await makeAgent(pg.handle.db, workspaceId, 'EstRan', 'openai', 'gpt-4.1');
    const freshAgent = await makeAgent(pg.handle.db, workspaceId, 'EstFresh', 'openai', 'gpt-4.1');

    // Give `ranAgent` one done run via a launch.
    await server.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: [ranAgent] },
    });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const res = await server.inject({ method: 'GET', url: '/agents/estimates' });
    expect(res.statusCode).toBe(200);
    const estimates = res.json() as {
      agent_id: string;
      agent_name: string;
      avg_cost_usd: number | null;
      sample_size: number;
    }[];
    const byId = Object.fromEntries(estimates.map((e) => [e.agent_id, e]));

    // The agent that ran has a real estimate (sample_size ≥ 1, priced avg ≈ 0.001).
    expect(byId[ranAgent]).toBeDefined();
    expect(byId[ranAgent]!.agent_name).toBe('EstRan');
    expect(byId[ranAgent]!.sample_size).toBeGreaterThanOrEqual(1);
    expect(byId[ranAgent]!.avg_cost_usd).toBeCloseTo(0.001);

    // The never-run agent is present with sample_size 0 and null averages.
    expect(byId[freshAgent]).toBeDefined();
    expect(byId[freshAgent]!.sample_size).toBe(0);
    expect(byId[freshAgent]!.avg_cost_usd).toBeNull();

    await server.close();
  });
});
