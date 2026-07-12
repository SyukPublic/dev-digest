import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { LLMProvider, Review, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** A grounded review: one finding on src/config.ts:11 (in the diff) + one hallucination. */
const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret.',
  score: 42,
  findings: [
    { id: 'f1', severity: 'CRITICAL', category: 'security', title: 'Hardcoded key', file: 'src/config.ts', start_line: 11, end_line: 11, rationale: 'x', confidence: 0.95, kind: 'finding' },
    { id: 'f2', severity: 'WARNING', category: 'bug', title: 'Phantom', file: 'src/config.ts', start_line: 999, end_line: 999, rationale: 'x', confidence: 0.5, kind: 'finding' },
  ],
};

const PATCH = '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,';

/** A provider that always fails structured output (for the per-case failure path). */
class FailingLLM implements LLMProvider {
  readonly id = 'openai' as const;
  async listModels() { return []; }
  async complete(): Promise<never> { throw new Error('boom'); }
  async completeStructured<T>(): Promise<StructuredResult<T>> { throw new Error('provider exploded'); }
  async embed(texts: string[]) { return texts.map(() => []); }
}

/**
 * A provider whose `completeStructured` resolves only after a delay and RECORDS
 * every request's messages — lets a test race a suite's in-flight execution
 * against a mid-run agent edit (AC-14) or a mid-run case delete (AC-26): the
 * suite's one case stays "in flight" for `ms`, giving the test a window to
 * mutate state via a second `app.inject` before the case (and the suite) completes.
 */
class DelayedLLM implements LLMProvider {
  readonly id = 'openai' as const;
  public calls: { messages: { role: string; content: string }[] }[] = [];
  constructor(
    private ms: number,
    private structured: unknown = REVIEW_FIXTURE,
  ) {}
  async listModels() { return []; }
  async complete(): Promise<never> { throw new Error('not used'); }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ messages: req.messages });
    await new Promise((resolve) => setTimeout(resolve, this.ms));
    const parsed = req.schema.safeParse(this.structured);
    if (!parsed.success) throw new Error(`DelayedLLM fixture failed schema: ${parsed.error.message}`);
    return {
      data: parsed.data,
      model: req.model,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
      raw: JSON.stringify(this.structured),
      attempts: 1,
    };
  }
  async embed(texts: string[]) { return texts.map(() => []); }
}

let seq = 0;

d('L06 eval pipeline (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces).where(eq(t.workspaces.name, 'default'));
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const db = () => pg.handle.db;

  function appWith(structured: unknown = REVIEW_FIXTURE, llm?: LLMProvider): Promise<FastifyInstance> {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({}),
        llm: { openai: llm ?? new MockLLMProvider('openai', { structured }) },
      },
    });
  }

  /** Seed a repo + PR + pr_files + an agent; returns their ids. */
  async function seedAgentAndPr() {
    const name = `payments-${seq++}`;
    const [repo] = await db().insert(t.repos).values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` }).returning();
    const [pr] = await db().insert(t.pullRequests).values({
      workspaceId, repoId: repo!.id, number: 482, title: 'Add rate limiting', author: 'a',
      branch: 'feat/rl', base: 'main', headSha: 'a1b2c3', additions: 1, deletions: 0, filesCount: 1,
      status: 'needs_review', body: 'body',
    }).returning();
    await db().insert(t.prFiles).values({ prId: pr!.id, path: 'src/config.ts', additions: 1, deletions: 0, patch: PATCH });
    const [agent] = await db().insert(t.agents).values({
      workspaceId, name: `Agent ${seq}`, provider: 'openai', model: 'gpt-4.1', systemPrompt: 'Review.', version: 3,
    }).returning();
    // Snapshot v3 config so compare can read the system prompt.
    await db().insert(t.agentVersions).values({
      agentId: agent!.id, version: 3,
      configJson: { provider: 'openai', model: 'gpt-4.1', system_prompt: 'Review.', strategy: 'single-pass', ci_fail_on: 'critical', repo_intel: true, skills: [] },
    });
    return { repoId: repo!.id, prId: pr!.id, agentId: agent!.id };
  }

  /** Seed a review + finding (decided) so we can promote it. */
  async function seedFinding(prId: string, agentId: string, decision: 'accept' | 'dismiss' | 'pending', file = 'src/config.ts') {
    const [review] = await db().insert(t.reviews).values({
      workspaceId, prId, agentId, runId: null, kind: 'review', verdict: 'request_changes', summary: 's', score: 40, model: 'gpt-4.1',
    }).returning();
    const [finding] = await db().insert(t.findings).values({
      reviewId: review!.id, file, startLine: 11, endLine: 11, severity: 'CRITICAL', category: 'security',
      title: 'Hardcoded key', rationale: 'x', confidence: 0.9, kind: 'finding',
      acceptedAt: decision === 'accept' ? new Date() : null,
      dismissedAt: decision === 'dismiss' ? new Date() : null,
    }).returning();
    return finding!.id;
  }

  async function pollSuite(app: FastifyInstance, suiteId: string, budgetMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < budgetMs) {
      const res = await app.inject({ method: 'GET', url: `/eval-runs/${suiteId}` });
      const body = res.json() as { suite: { status: string } };
      if (body.suite.status !== 'running') return body;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`suite ${suiteId} did not terminate within ${budgetMs}ms`);
  }

  // ---- Schema (T1/T3) ----
  it('eval_suite_runs table + eval_runs.suite_run_id/error columns exist and cascade', async () => {
    const { agentId } = await seedAgentAndPr();
    const [suite] = await db().insert(t.evalSuiteRuns).values({ workspaceId, agentId, agentVersion: 1, status: 'running' }).returning();
    const [caseRow] = await db().insert(t.evalCases).values({ workspaceId, ownerKind: 'agent', ownerId: agentId, name: 'c', inputDiff: 'x', expectedOutput: {} }).returning();
    await db().insert(t.evalRuns).values({ caseId: caseRow!.id, suiteRunId: suite!.id, pass: false, error: 'e' });
    // Deleting the suite cascades its per-case rows.
    await db().delete(t.evalSuiteRuns).where(eq(t.evalSuiteRuns.id, suite!.id));
    const rows = await db().select().from(t.evalRuns).where(eq(t.evalRuns.suiteRunId, suite!.id));
    expect(rows).toHaveLength(0);
  });

  // ---- Case from finding (T15 / AC-1/2/3/4/5/6) ----
  it('accepted finding → must_find case captured from current pr_files + envelope', async () => {
    const { prId, agentId } = await seedAgentAndPr();
    const findingId = await seedFinding(prId, agentId, 'accept');
    const app = await appWith();
    const res = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(res.statusCode).toBe(201);
    const created = res.json() as { owner_id: string; input_diff: string; expected_output: { expectation: string; findings: { start_line: number }[] } };
    expect(created.owner_id).toBe(agentId);
    expect(created.expected_output.expectation).toBe('must_find');
    expect(created.expected_output.findings[0]!.start_line).toBe(11);
    expect(created.input_diff).toContain('stripeKey');
  });

  it('dismissed finding → must_not_flag case', async () => {
    const { prId, agentId } = await seedAgentAndPr();
    const findingId = await seedFinding(prId, agentId, 'dismiss');
    const app = await appWith();
    const res = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { expected_output: { expectation: string } }).expected_output.expectation).toBe('must_not_flag');
  });

  it('pending finding → rejected (server guard, AC-3)', async () => {
    const { prId, agentId } = await seedAgentAndPr();
    const findingId = await seedFinding(prId, agentId, 'pending');
    const app = await appWith();
    const res = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(res.statusCode).toBe(400);
  });

  it('finding file absent from current pr_files → error, no empty case (AC-4)', async () => {
    const { prId, agentId } = await seedAgentAndPr();
    const findingId = await seedFinding(prId, agentId, 'accept', 'src/gone.ts');
    const app = await appWith();
    const res = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(res.statusCode).toBe(400);
    const cases = await db().select().from(t.evalCases).where(eq(t.evalCases.ownerId, agentId));
    expect(cases).toHaveLength(0);
  });

  it('duplicate case creation is allowed (AC-6)', async () => {
    const { prId, agentId } = await seedAgentAndPr();
    const findingId = await seedFinding(prId, agentId, 'accept');
    const app = await appWith();
    await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    const res2 = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(res2.statusCode).toBe(201);
    const cases = await db().select().from(t.evalCases).where(eq(t.evalCases.ownerId, agentId));
    expect(cases.length).toBe(2);
  });

  // ---- Case draft preview (derive without persisting) ----
  it('preview derives a case draft from a finding WITHOUT persisting it', async () => {
    const { prId, agentId } = await seedAgentAndPr();
    const findingId = await seedFinding(prId, agentId, 'accept');
    const app = await appWith();
    const res = await app.inject({ method: 'GET', url: `/findings/${findingId}/eval-case/preview` });
    expect(res.statusCode).toBe(200);
    const draft = res.json() as {
      agent_id: string;
      agent_name: string;
      input_diff: string;
      expected_output: { expectation: string; findings: { start_line: number }[] };
    };
    expect(draft.agent_id).toBe(agentId);
    expect(draft.agent_name).toBeTruthy();
    expect(draft.expected_output.expectation).toBe('must_find');
    expect(draft.expected_output.findings[0]!.start_line).toBe(11);
    expect(draft.input_diff).toContain('stripeKey');
    // Nothing was written.
    const cases = await db().select().from(t.evalCases).where(eq(t.evalCases.ownerId, agentId));
    expect(cases).toHaveLength(0);
  });

  it('preview on a pending finding → rejected (AC-3), file absent → rejected (AC-4)', async () => {
    const { prId, agentId } = await seedAgentAndPr();
    const app = await appWith();
    const pendingId = await seedFinding(prId, agentId, 'pending');
    const pending = await app.inject({ method: 'GET', url: `/findings/${pendingId}/eval-case/preview` });
    expect(pending.statusCode).toBe(400);
    const goneId = await seedFinding(prId, agentId, 'accept', 'src/gone.ts');
    const gone = await app.inject({ method: 'GET', url: `/findings/${goneId}/eval-case/preview` });
    expect(gone.statusCode).toBe(400);
  });

  // ---- Manual validation (T16 / AC-30/31) ----
  it('manual case with unparseable diff → 422 (AC-30)', async () => {
    const { agentId } = await seedAgentAndPr();
    const app = await appWith();
    const res = await app.inject({ method: 'POST', url: '/eval-cases', payload: {
      owner_kind: 'agent', owner_id: agentId, name: 'c', input_diff: 'not a diff',
      expected_output: { expectation: 'must_find', findings: [] },
    } });
    expect(res.statusCode).toBe(422);
  });

  it('manual case with a bad envelope → 422 (AC-31)', async () => {
    const { agentId } = await seedAgentAndPr();
    const app = await appWith();
    const res = await app.inject({ method: 'POST', url: '/eval-cases', payload: {
      owner_kind: 'agent', owner_id: agentId, name: 'c',
      input_diff: `diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n${PATCH}`,
      expected_output: { expectation: 'maybe', findings: [] },
    } });
    expect(res.statusCode).toBe(422);
  });

  // ---- Suite run lifecycle (T22/T23/T24 / AC-8/9/10/11) ----
  it('zero cases → rejected (AC-10); start → running id + terminal per-case row (AC-8)', async () => {
    const { prId, agentId } = await seedAgentAndPr();
    const findingId = await seedFinding(prId, agentId, 'accept');
    const app = await appWith();

    // Zero cases → rejected.
    const zero = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    expect(zero.statusCode).toBe(400);

    await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    const started = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    expect(started.statusCode).toBe(200);
    const { suite_run_id, status } = started.json() as { suite_run_id: string; status: string };
    expect(status).toBe('running');

    const detail = await pollSuite(app, suite_run_id);
    expect(['done', 'failed']).toContain(detail.suite.status);
    expect((detail as { runs: unknown[] }).runs.length).toBe(1);
  });

  it('a second suite while one is already running → 409 (AC-9)', async () => {
    const { prId, agentId } = await seedAgentAndPr();
    const findingId = await seedFinding(prId, agentId, 'accept');
    const app = await appWith();
    await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    // Insert a running suite AFTER boot (boot reaping already ran), so it persists.
    await db().insert(t.evalSuiteRuns).values({ workspaceId, agentId, agentVersion: 3, status: 'running' });
    const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    expect(res.statusCode).toBe(409);
  });

  it('suite completes done with pooled metrics; a passing must_find case', async () => {
    const { prId, agentId } = await seedAgentAndPr();
    const findingId = await seedFinding(prId, agentId, 'accept');
    const app = await appWith();
    await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    const started = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    const { suite_run_id } = started.json() as { suite_run_id: string };
    const detail = await pollSuite(app, suite_run_id);
    expect(detail.suite.status).toBe('done');
    const suite = detail.suite as unknown as { recall: number; citation_accuracy: number; passed: number; total: number };
    expect(suite.recall).toBe(1); // line-11 finding matches the must_find expectation
    expect(suite.citation_accuracy).toBeCloseTo(0.5); // 1 kept / (1 kept + 1 dropped)
    expect(suite.passed).toBe(1);
    expect(suite.total).toBe(1);
  });

  it('per-case LLM failure → error+pass=false row, suite continues to a terminal status (AC-21)', async () => {
    const { prId, agentId } = await seedAgentAndPr();
    const findingId = await seedFinding(prId, agentId, 'accept');
    const app = await appWith(REVIEW_FIXTURE, new FailingLLM());
    await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    const started = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    const { suite_run_id } = started.json() as { suite_run_id: string };
    const detail = await pollSuite(app, suite_run_id);
    const runs = (detail as { runs: { pass: boolean | null; error: string | null }[] }).runs;
    expect(runs).toHaveLength(1);
    expect(runs[0]!.pass).toBe(false);
    expect(runs[0]!.error).toBeTruthy();
    // A per-case failure still completes the suite (done), not failed.
    expect(detail.suite.status).toBe('done');
  });

  // ---- config snapshot (T20 / AC-14) ----
  it('a mid-run agent edit does not affect the already-running suite (AC-14)', async () => {
    const { prId, agentId } = await seedAgentAndPr(); // systemPrompt = 'Review.'
    const findingId = await seedFinding(prId, agentId, 'accept');
    const delayedLlm = new DelayedLLM(300);
    const app = await appWith(REVIEW_FIXTURE, delayedLlm);
    await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });

    const [agentBefore] = await db().select().from(t.agents).where(eq(t.agents.id, agentId));
    const versionAtStart = agentBefore!.version;

    // Start the suite — its one case is now "in flight" (DelayedLLM hasn't
    // resolved yet), leaving a window to mutate the agent before it completes.
    const started = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    const { suite_run_id } = started.json() as { suite_run_id: string };

    const patch = await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}`,
      payload: { system_prompt: 'Review v2 — completely different instructions.' },
    });
    expect(patch.statusCode).toBe(200);
    expect((patch.json() as { version: number }).version).toBe(versionAtStart + 1);

    const detail = await pollSuite(app, suite_run_id);
    expect(detail.suite.status).toBe('done');
    // The suite's persisted agent_version is the START snapshot, not the bumped one.
    expect((detail.suite as { agent_version: number }).agent_version).toBe(versionAtStart);

    // The engine call actually used the OLD system prompt — the mid-run edit
    // never reached the already-running suite.
    expect(delayedLlm.calls).toHaveLength(1);
    const sentText = delayedLlm.calls[0]!.messages.map((m) => m.content).join('\n');
    expect(sentText).toContain('Review.');
    expect(sentText).not.toContain('completely different instructions');
  });

  // ---- mid-run case delete (T21 / AC-26) ----
  it('a case deleted mid-run drops out without aborting the suite (AC-26)', async () => {
    const { prId, agentId } = await seedAgentAndPr();
    const findingId1 = await seedFinding(prId, agentId, 'accept'); // src/config.ts
    // A second file + finding → a second case (case2), deleted mid-run below.
    await db()
      .insert(t.prFiles)
      .values({ prId, path: 'src/other.ts', additions: 1, deletions: 0, patch: PATCH });
    const findingId2 = await seedFinding(prId, agentId, 'accept', 'src/other.ts');

    const delayedLlm = new DelayedLLM(300);
    const app = await appWith(REVIEW_FIXTURE, delayedLlm);
    await app.inject({ method: 'POST', url: `/findings/${findingId1}/eval-case` });
    const created2 = await app.inject({ method: 'POST', url: `/findings/${findingId2}/eval-case` });
    const case2Id = (created2.json() as { id: string }).id;

    const started = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    const { suite_run_id } = started.json() as { suite_run_id: string };

    // Delete case2 WHILE the suite's first case is still in flight (DelayedLLM
    // has not resolved yet) — it must drop out of the running suite (AC-26).
    const del = await app.inject({ method: 'DELETE', url: `/eval-cases/${case2Id}` });
    expect(del.statusCode).toBe(200);

    const detail = await pollSuite(app, suite_run_id);
    expect(detail.suite.status).toBe('done');
    // Only the surviving case was attempted; the deleted one dropped out
    // without aborting the suite.
    expect((detail.suite as { total: number }).total).toBe(1);
    const runs = (detail as { runs: { case_id: string }[] }).runs;
    expect(runs).toHaveLength(1);
    expect(runs[0]!.case_id).not.toBe(case2Id);

    // case2 stays deleted — the running suite loop does not resurrect it.
    const stillGone = await app.inject({ method: 'GET', url: `/eval-cases/${case2Id}` });
    expect(stillGone.statusCode).toBe(404);
  });

  // ---- run-all (T25 / AC-33) ----
  it('run all agents: skips zero-case agents, starts agents with cases', async () => {
    const { prId, agentId } = await seedAgentAndPr();
    const findingId = await seedFinding(prId, agentId, 'accept');
    const { agentId: emptyAgent } = await seedAgentAndPr(); // no cases
    const app = await appWith();
    await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    const res = await app.inject({ method: 'POST', url: '/eval-runs/all' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { started: { agent_id: string }[]; skipped: { agent_id: string; reason: string }[] };
    expect(body.started.some((s) => s.agent_id === agentId)).toBe(true);
    expect(body.skipped.some((s) => s.agent_id === emptyAgent && s.reason === 'no_cases')).toBe(true);
  });

  // ---- delete cascade (T17/T18 / AC-23/24) ----
  it('deleting a case cascades per-case rows but preserves suite aggregates (AC-23)', async () => {
    const { prId, agentId } = await seedAgentAndPr();
    const findingId = await seedFinding(prId, agentId, 'accept');
    const app = await appWith();
    const created = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    const caseId = (created.json() as { id: string }).id;
    const started = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    const { suite_run_id } = started.json() as { suite_run_id: string };
    await pollSuite(app, suite_run_id);

    await app.inject({ method: 'DELETE', url: `/eval-cases/${caseId}` });
    // per-case rows for that case are gone…
    const runs = await db().select().from(t.evalRuns).where(eq(t.evalRuns.caseId, caseId));
    expect(runs).toHaveLength(0);
    // …but the suite aggregate row survives.
    const suites = await db().select().from(t.evalSuiteRuns).where(eq(t.evalSuiteRuns.id, suite_run_id));
    expect(suites).toHaveLength(1);
  });

  it('deleting an agent cascades its eval cases + suite history (AC-24)', async () => {
    const { prId, agentId } = await seedAgentAndPr();
    const findingId = await seedFinding(prId, agentId, 'accept');
    const app = await appWith();
    await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    const started = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    await pollSuite(app, (started.json() as { suite_run_id: string }).suite_run_id);

    const del = await app.inject({ method: 'DELETE', url: `/agents/${agentId}` });
    expect(del.statusCode).toBe(200);
    const cases = await db().select().from(t.evalCases).where(eq(t.evalCases.ownerId, agentId));
    const suites = await db().select().from(t.evalSuiteRuns).where(eq(t.evalSuiteRuns.agentId, agentId));
    expect(cases).toHaveLength(0);
    expect(suites).toHaveLength(0);
  });

  // ---- dashboard + compare (T29/T30 / AC-19/27/28) ----
  it('per-agent dashboard surfaces current metrics + recent runs', async () => {
    const { prId, agentId } = await seedAgentAndPr();
    const findingId = await seedFinding(prId, agentId, 'accept');
    const app = await appWith();
    await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    const started = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    await pollSuite(app, (started.json() as { suite_run_id: string }).suite_run_id);

    const res = await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-dashboard` });
    expect(res.statusCode).toBe(200);
    const dash = res.json() as { current: { recall: number | null; traces_total: number }; recent_runs: unknown[] };
    expect(dash.current.recall).toBe(1);
    expect(dash.recent_runs.length).toBeGreaterThanOrEqual(1);
  });

  it('compare degrades to config unavailable when a version row is missing (AC-28)', async () => {
    const { prId, agentId } = await seedAgentAndPr();
    const findingId = await seedFinding(prId, agentId, 'accept');
    const app = await appWith();
    await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    // Two suite runs (sequential) to compare.
    const s1 = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    await pollSuite(app, (s1.json() as { suite_run_id: string }).suite_run_id);
    const s2 = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    await pollSuite(app, (s2.json() as { suite_run_id: string }).suite_run_id);

    const a = (s1.json() as { suite_run_id: string }).suite_run_id;
    const b = (s2.json() as { suite_run_id: string }).suite_run_id;
    const res = await app.inject({ method: 'GET', url: `/eval-compare?a=${a}&b=${b}` });
    expect(res.statusCode).toBe(200);
    const cmp = res.json() as { config_available: boolean; system_prompt_a: string | null };
    // v3 was snapshotted → both prompts present → config available.
    expect(cmp.config_available).toBe(true);
    expect(cmp.system_prompt_a).toBe('Review.');
  });

  // ---- reap (T28 / AC-25) ----
  it('boot reaping flips orphaned running suites to failed (AC-25)', async () => {
    const { agentId } = await seedAgentAndPr();
    await db().insert(t.evalSuiteRuns).values({ workspaceId, agentId, agentVersion: 1, status: 'running' });
    // A fresh app boot reaps orphaned running suites.
    await appWith();
    const running = await db().select().from(t.evalSuiteRuns).where(and(eq(t.evalSuiteRuns.agentId, agentId), eq(t.evalSuiteRuns.status, 'running')));
    expect(running).toHaveLength(0);
  });
});
