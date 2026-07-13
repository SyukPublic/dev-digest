import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { LLMProvider, Review, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skill-eval] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * Phase 4 (T16–T32) — the differential skill-eval SERVICE + ROUTES.
 *
 * A skill delta is scored by running its host agent TWICE per case (WITHOUT / WITH
 * the skill) and keeping the findings the skill caused. To make the arms actually
 * DIFFER under a deterministic mock, the LLM below emits a grounded finding ONLY
 * when the eval skill's marker appears in the assembled prompt (i.e. the WITH
 * arm) — so the delta = that caused finding.
 */

// A distinctive marker only the eval skill's body carries; the WITH arm's prompt
// includes it (skills are assembled into the messages), the WITHOUT arm's doesn't.
const SKILL_MARKER = 'ZZZ_SKILL_MARKER_STRIPE_SECRET';

/** Unified diff for src/config.ts line 11 — the caused finding grounds here. */
const PATCH = '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,';
const CASE_DIFF = `diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n${PATCH}`;

const CAUSED_FINDING = {
  id: 'f1',
  severity: 'CRITICAL',
  category: 'security',
  title: 'Hardcoded key',
  file: 'src/config.ts',
  start_line: 11,
  end_line: 11,
  rationale: 'x',
  confidence: 0.95,
  kind: 'finding',
} as const;

/** Emits the caused finding ONLY when the skill marker is present (delta-producing). */
class SkillAwareLLM implements LLMProvider {
  readonly id = 'openai' as const;
  public calls = 0;
  async listModels() {
    return [];
  }
  async complete(): Promise<never> {
    throw new Error('not used');
  }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls += 1;
    const text = req.messages.map((m) => m.content).join('\n');
    const withSkill = text.includes(SKILL_MARKER);
    const review: Review = withSkill
      ? { verdict: 'request_changes', summary: 's', score: 42, findings: [{ ...CAUSED_FINDING }] }
      : { verdict: 'comment', summary: 'ok', score: 90, findings: [] };
    const parsed = req.schema.safeParse(review);
    if (!parsed.success) throw new Error(`fixture failed schema: ${parsed.error.message}`);
    return {
      data: parsed.data,
      model: req.model,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
      raw: JSON.stringify(review),
      attempts: 1,
    };
  }
  async embed(texts: string[]) {
    return texts.map(() => []);
  }
}

/** Emits ZERO findings in both arms (empty delta → null metrics / clean pass). */
class CleanLLM implements LLMProvider {
  readonly id = 'openai' as const;
  async listModels() {
    return [];
  }
  async complete(): Promise<never> {
    throw new Error('not used');
  }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const review: Review = { verdict: 'comment', summary: 'ok', score: 90, findings: [] };
    const parsed = req.schema.safeParse(review);
    if (!parsed.success) throw new Error('fixture failed schema');
    return {
      data: parsed.data,
      model: req.model,
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.001,
      raw: JSON.stringify(review),
      attempts: 1,
    };
  }
  async embed(texts: string[]) {
    return texts.map(() => []);
  }
}

/**
 * A skill-marker-aware provider whose `completeStructured` resolves only after
 * a delay and RECORDS every request's messages — lets a test race a suite's
 * in-flight (WITH-arm) execution against a mid-run skill/host edit (AC-12):
 * the suite's one case stays "in flight" for `ms`, giving the test a window to
 * mutate the skill body / host config via a second `app.inject` before the
 * case (and the suite) completes. Mirrors the L06 `DelayedLLM` (eval.it.test.ts).
 */
class DelayedSkillAwareLLM implements LLMProvider {
  readonly id = 'openai' as const;
  public calls: { messages: { role: string; content: string }[] }[] = [];
  constructor(
    private marker: string,
    private ms = 300,
  ) {}
  async listModels() {
    return [];
  }
  async complete(): Promise<never> {
    throw new Error('not used');
  }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ messages: req.messages });
    await new Promise((resolve) => setTimeout(resolve, this.ms));
    const text = req.messages.map((m) => m.content).join('\n');
    const withSkill = text.includes(this.marker);
    const review: Review = withSkill
      ? { verdict: 'request_changes', summary: 's', score: 42, findings: [{ ...CAUSED_FINDING }] }
      : { verdict: 'comment', summary: 'ok', score: 90, findings: [] };
    const parsed = req.schema.safeParse(review);
    if (!parsed.success) throw new Error(`fixture failed schema: ${parsed.error.message}`);
    return {
      data: parsed.data,
      model: req.model,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
      raw: JSON.stringify(review),
      attempts: 1,
    };
  }
  async embed(texts: string[]) {
    return texts.map(() => []);
  }
}

/** Always fails structured output → the per-case (either-arm) failure path. */
class FailingLLM implements LLMProvider {
  readonly id = 'openai' as const;
  async listModels() {
    return [];
  }
  async complete(): Promise<never> {
    throw new Error('boom');
  }
  async completeStructured<T>(): Promise<StructuredResult<T>> {
    throw new Error('provider exploded');
  }
  async embed(texts: string[]) {
    return texts.map(() => []);
  }
}

let seq = 0;

d('Skill eval pipeline — differential (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db
      .select()
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const db = () => pg.handle.db;

  function appWith(llm: LLMProvider = new SkillAwareLLM()): Promise<FastifyInstance> {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { git: new MockGitClient({}), llm: { openai: llm } },
    });
  }

  /** Seed a skill (+ its skill_versions snapshot). */
  async function seedSkill(opts: { enabled?: boolean; version?: number; body?: string } = {}) {
    const version = opts.version ?? 1;
    const body = opts.body ?? `Flag hardcoded secrets. ${SKILL_MARKER}`;
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

  /** Seed a host agent (optionally linking a skill). Provider is openai (mock). */
  async function seedHost(opts: { enabled?: boolean; linkSkillId?: string } = {}) {
    const [agent] = await db()
      .insert(t.agents)
      .values({
        workspaceId,
        name: `Host ${seq++}`,
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'Review this diff.',
        enabled: opts.enabled ?? true,
        version: 3,
      })
      .returning();
    if (opts.linkSkillId) {
      await db()
        .insert(t.agentSkills)
        .values({ agentId: agent!.id, skillId: opts.linkSkillId, order: 0 });
    }
    return agent!;
  }

  /** Create a skill eval case via the owner-generic route. */
  async function createSkillCase(
    app: FastifyInstance,
    skillId: string,
    expected: unknown = {
      expectation: 'must_find',
      findings: [{ file: 'src/config.ts', start_line: 11, end_line: 11 }],
    },
  ) {
    const res = await app.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: {
        owner_kind: 'skill',
        owner_id: skillId,
        name: `case-${seq++}`,
        input_diff: CASE_DIFF,
        expected_output: expected,
      },
    });
    return res;
  }

  async function pollSkillSuite(app: FastifyInstance, suiteId: string, budgetMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < budgetMs) {
      const res = await app.inject({ method: 'GET', url: `/skill-eval-runs/${suiteId}` });
      const body = res.json() as { suite: { status: string } };
      if (body.suite.status !== 'running') return body;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`skill suite ${suiteId} did not terminate within ${budgetMs}ms`);
  }

  // ---- T16 — owner-generic case CRUD (test_skill_case_crud / AC-2/AC-3) ----
  it('creates a skill eval case (owner_kind=skill); unknown skill → 404', async () => {
    const skill = await seedSkill();
    const app = await appWith();
    const res = await createSkillCase(app, skill.id);
    expect(res.statusCode).toBe(201);
    const created = res.json() as { owner_kind: string; owner_id: string };
    expect(created.owner_kind).toBe('skill');
    expect(created.owner_id).toBe(skill.id);

    const missing = await createSkillCase(app, '00000000-0000-0000-0000-000000000000');
    expect(missing.statusCode).toBe(404);
  });

  it('skill case with an unparseable diff → 422 (AC-30); bad envelope → 422 (AC-31)', async () => {
    const skill = await seedSkill();
    const app = await appWith();
    const badDiff = await app.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: {
        owner_kind: 'skill',
        owner_id: skill.id,
        name: 'c',
        input_diff: 'not a diff',
        expected_output: { expectation: 'must_find', findings: [] },
      },
    });
    expect(badDiff.statusCode).toBe(422);

    const badEnvelope = await createSkillCase(app, skill.id, { expectation: 'maybe', findings: [] });
    expect(badEnvelope.statusCode).toBe(422);
  });

  // ---- T18 — host resolution (test_host_resolution / AC-4/AC-6) ----
  it('eval-hosts: default = first enabled agent linking the skill; each carries enabled', async () => {
    const skill = await seedSkill();
    const linkingA = await seedHost({ linkSkillId: skill.id });
    await seedHost({ linkSkillId: skill.id }); // second linking host
    const app = await appWith();
    const res = await app.inject({ method: 'GET', url: `/skills/${skill.id}/eval-hosts` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      default_host_id: string;
      candidates: { id: string; enabled: boolean }[];
    };
    expect(body.default_host_id).toBe(linkingA.id);
    expect(body.candidates.map((c) => c.id)).toContain(linkingA.id);
    expect(body.candidates.every((c) => c.enabled)).toBe(true);
  });

  it('eval-hosts: no linking agent → default null, falls back to the enabled-agent list', async () => {
    const skill = await seedSkill();
    const enabledNonLinking = await seedHost({ enabled: true });
    const app = await appWith();
    const res = await app.inject({ method: 'GET', url: `/skills/${skill.id}/eval-hosts` });
    const body = res.json() as { default_host_id: string | null; candidates: { id: string }[] };
    expect(body.default_host_id).toBeNull();
    expect(body.candidates.map((c) => c.id)).toContain(enabledNonLinking.id);
  });

  // ---- T17 — snapshot resolution (test_skill_snapshot / AC-1/AC-12) ----
  it('a mid-run skill/host edit does NOT change the already-running suite; version is captured at start (AC-12)', async () => {
    const ORIGINAL_MARKER = 'ZZZ_ORIGINAL_MARKER_V1';
    const skill = await seedSkill({ body: `Flag hardcoded secrets. ${ORIGINAL_MARKER}` });
    const host = await seedHost({ linkSkillId: skill.id });
    const delayedLlm = new DelayedSkillAwareLLM(ORIGINAL_MARKER, 300);
    const app = await appWith(delayedLlm);
    await createSkillCase(app, skill.id);

    const versionAtStart = skill.version;
    const hostVersionAtStart = host.version;

    // Start the suite — its one case's WITH arm is now "in flight" (the
    // DelayedSkillAwareLLM hasn't resolved yet), leaving a window to mutate the
    // skill body/version and the host version before it completes.
    const started = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/eval-runs`,
      payload: { host_agent_id: host.id },
    });
    const { suite_run_id } = started.json() as { suite_run_id: string };

    // Confirm it's genuinely still running before mutating underneath it.
    const mid = await app.inject({ method: 'GET', url: `/skill-eval-runs/${suite_run_id}` });
    expect((mid.json() as { suite: { status: string } }).suite.status).toBe('running');

    // Mutate the skill body (new marker + bumped version) and the host
    // (bumped version via a system_prompt change) WHILE the suite is running.
    const skillPatch = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { body: 'Flag NOTHING — completely different rule. NEW_MARKER_NEVER_USED' },
    });
    expect(skillPatch.statusCode).toBe(200);
    expect((skillPatch.json() as { version: number }).version).toBe(versionAtStart + 1);
    const hostPatch = await app.inject({
      method: 'PUT',
      url: `/agents/${host.id}`,
      payload: { system_prompt: 'Review v2 — completely different instructions.' },
    });
    expect(hostPatch.statusCode).toBe(200);
    expect((hostPatch.json() as { version: number }).version).toBe(hostVersionAtStart + 1);

    const detail = await pollSkillSuite(app, suite_run_id);
    const suite = detail.suite as unknown as {
      status: string;
      recall: number;
      skill_version: number;
      host_agent_version: number;
    };
    expect(suite.status).toBe('done');
    // The suite's persisted skill_version / host_agent_version are the START
    // snapshot, not the mid-run bumped ones (AC-12).
    expect(suite.skill_version).toBe(versionAtStart);
    expect(suite.host_agent_version).toBe(hostVersionAtStart);
    // The WITH arm actually used the OLD skill body (the original marker) — the
    // mid-run body edit never reached the already-running suite — so the caused
    // finding is still present (recall 1).
    expect(suite.recall).toBe(1);
    expect(delayedLlm.calls).toHaveLength(2); // WITHOUT + WITH arm, one case
    const sentTexts = delayedLlm.calls.map((c) => c.messages.map((m) => m.content).join('\n'));
    expect(sentTexts.some((t) => t.includes(ORIGINAL_MARKER))).toBe(true);
    expect(sentTexts.every((t) => !t.includes('NEW_MARKER_NEVER_USED'))).toBe(true);
  });

  // ---- T19 / T22 — suite lifecycle (test_skill_suite_run / AC-8/AC-11/AC-19/AC-20) ----
  it('start → running id; delta caught finding; terminal per-case delta row (AC-8/AC-11)', async () => {
    const skill = await seedSkill();
    const host = await seedHost({ linkSkillId: skill.id });
    const app = await appWith();
    await createSkillCase(app, skill.id);

    const started = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/eval-runs`,
      payload: { host_agent_id: host.id },
    });
    expect(started.statusCode).toBe(200);
    const { suite_run_id, status } = started.json() as { suite_run_id: string; status: string };
    expect(status).toBe('running');

    const detail = await pollSkillSuite(app, suite_run_id);
    expect(detail.suite.status).toBe('done');
    const suite = detail.suite as unknown as {
      recall: number;
      precision: number;
      citation_accuracy: number;
      passed: number;
      total: number;
      host_agent_id: string;
      skill_version: number;
    };
    expect(suite.recall).toBe(1); // the caused finding matches the must_find expectation
    expect(suite.precision).toBe(1);
    expect(suite.passed).toBe(1);
    expect(suite.total).toBe(1);
    expect(suite.host_agent_id).toBe(host.id);
    expect(suite.skill_version).toBe(skill.version);

    // The per-case row carries the classified delta (caught) as actual_output.
    const runs = (detail as { runs: { actual_output: unknown; pass: boolean | null }[] }).runs;
    expect(runs).toHaveLength(1);
    const delta = runs[0]!.actual_output as { findings: { classification: string }[] };
    expect(delta.findings[0]!.classification).toBe('caught');
    expect(runs[0]!.pass).toBe(true);
  });

  it('zero cases → 400; a second suite while one runs → 409; disabled host → 400', async () => {
    const skill = await seedSkill();
    const host = await seedHost({ linkSkillId: skill.id });
    const app = await appWith();

    // Zero cases → 400.
    const zero = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/eval-runs`,
      payload: { host_agent_id: host.id },
    });
    expect(zero.statusCode).toBe(400);

    await createSkillCase(app, skill.id);
    // Insert a running skill suite AFTER boot so it persists → 409.
    await db().insert(t.evalSkillSuiteRuns).values({
      workspaceId,
      skillId: skill.id,
      skillVersion: skill.version,
      hostAgentId: host.id,
      hostAgentVersion: host.version,
      status: 'running',
    });
    const conflict = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/eval-runs`,
      payload: { host_agent_id: host.id },
    });
    expect(conflict.statusCode).toBe(409);

    // Disabled host → 400.
    const disabled = await seedHost({ enabled: false });
    const skill2 = await seedSkill();
    const app2 = await appWith();
    await createSkillCase(app2, skill2.id);
    const badHost = await app2.inject({
      method: 'POST',
      url: `/skills/${skill2.id}/eval-runs`,
      payload: { host_agent_id: disabled.id },
    });
    expect(badHost.statusCode).toBe(400);
  });

  // ---- T20 — run all skills (test_run_all_skills / AC-25) ----
  it('run all skills: starts runnable, skips no_cases / no_host', async () => {
    const runnable = await seedSkill();
    await seedHost({ linkSkillId: runnable.id });
    const noHost = await seedSkill(); // has a case but no linking enabled agent
    const noCases = await seedSkill(); // linking host but no cases
    await seedHost({ linkSkillId: noCases.id });

    const app = await appWith();
    await createSkillCase(app, runnable.id);
    await createSkillCase(app, noHost.id);

    const res = await app.inject({ method: 'POST', url: '/skill-eval-runs/all' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      started: { skill_id: string; suite_run_id: string }[];
      skipped: { skill_id: string; reason: string }[];
    };
    expect(body.started.some((s) => s.skill_id === runnable.id)).toBe(true);
    expect(body.skipped.some((s) => s.skill_id === noHost.id && s.reason === 'no_host')).toBe(true);
    expect(body.skipped.some((s) => s.skill_id === noCases.id && s.reason === 'no_cases')).toBe(true);

    // Let the started suite terminate so it doesn't leak "running" into later tests.
    const startedRun = body.started.find((s) => s.skill_id === runnable.id)!;
    await pollSkillSuite(app, startedRun.suite_run_id);
  });

  // ---- T21 — single skill case (test_single_skill_case / AC-9) ----
  it('runs a single skill case through the two-arm executor', async () => {
    const skill = await seedSkill();
    const host = await seedHost({ linkSkillId: skill.id });
    const app = await appWith();
    const created = await createSkillCase(app, skill.id);
    const caseId = (created.json() as { id: string }).id;

    const res = await app.inject({
      method: 'POST',
      url: `/eval-cases/${caseId}/skill-run`,
      payload: { host_agent_id: host.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { result: { recall: number; traces_passed: number } };
    expect(body.result.recall).toBe(1);
    expect(body.result.traces_passed).toBe(1);
  });

  // ---- T30 — per-case + suite cost combines both arms (test_skill_cost / AC-18) ----
  it('suite cost is the sum of both arms per case (never treats unknown as 0)', async () => {
    const skill = await seedSkill();
    const host = await seedHost({ linkSkillId: skill.id });
    const app = await appWith();
    await createSkillCase(app, skill.id);
    const started = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/eval-runs`,
      payload: { host_agent_id: host.id },
    });
    const detail = await pollSkillSuite(app, (started.json() as { suite_run_id: string }).suite_run_id);
    // Two arms × 0.001 each = 0.002 for the single case.
    expect((detail.suite as unknown as { cost_usd: number }).cost_usd).toBeCloseTo(0.002);
  });

  // ---- T32 — zero-denominator metrics recorded null (test_null_metrics / AC-14) ----
  it('an empty delta on a clean must_not_flag case → null recall/precision/citation', async () => {
    const skill = await seedSkill();
    const host = await seedHost({ linkSkillId: skill.id });
    const app = await appWith(new CleanLLM());
    await createSkillCase(app, skill.id, { expectation: 'must_not_flag', findings: [] });
    const started = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/eval-runs`,
      payload: { host_agent_id: host.id },
    });
    const detail = await pollSkillSuite(app, (started.json() as { suite_run_id: string }).suite_run_id);
    const suite = detail.suite as unknown as {
      recall: number | null;
      precision: number | null;
      citation_accuracy: number | null;
      passed: number;
      status: string;
    };
    expect(suite.status).toBe('done');
    expect(suite.recall).toBeNull();
    expect(suite.precision).toBeNull();
    expect(suite.citation_accuracy).toBeNull();
    expect(suite.passed).toBe(1); // clean fixture, no noise → pass
  });

  // ---- T31 — either-arm failure → error row, suite continues (test_skill_failure / AC-21) ----
  it('a per-case (arm) failure writes an error+pass=false row and the suite still finishes', async () => {
    const skill = await seedSkill();
    const host = await seedHost({ linkSkillId: skill.id });
    const app = await appWith(new FailingLLM());
    await createSkillCase(app, skill.id);
    const started = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/eval-runs`,
      payload: { host_agent_id: host.id },
    });
    const detail = await pollSkillSuite(app, (started.json() as { suite_run_id: string }).suite_run_id);
    const runs = (detail as { runs: { pass: boolean | null; error: string | null }[] }).runs;
    expect(runs).toHaveLength(1);
    expect(runs[0]!.pass).toBe(false);
    expect(runs[0]!.error).toBeTruthy();
    expect(detail.suite.status).toBe('done');
  });

  // ---- T23 — per-skill dashboard (test_skill_dashboard / AC-26) ----
  it('per-skill dashboard surfaces current delta metrics + recent runs', async () => {
    const skill = await seedSkill();
    const host = await seedHost({ linkSkillId: skill.id });
    const app = await appWith();
    await createSkillCase(app, skill.id);
    const started = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/eval-runs`,
      payload: { host_agent_id: host.id },
    });
    await pollSkillSuite(app, (started.json() as { suite_run_id: string }).suite_run_id);

    const res = await app.inject({ method: 'GET', url: `/skills/${skill.id}/eval-dashboard` });
    expect(res.statusCode).toBe(200);
    const dash = res.json() as {
      skill_name: string;
      current: { recall: number | null };
      recent_runs: unknown[];
      trend: { skill_version: number; host_agent_version: number }[];
    };
    expect(dash.current.recall).toBe(1);
    expect(dash.recent_runs.length).toBeGreaterThanOrEqual(1);
    expect(dash.trend[0]!.host_agent_version).toBe(host.version);
  });

  // ---- T24 — all-skills dashboard (test_skills_workspace_dashboard / AC-24) ----
  it('all-skills dashboard lists the skill with its latest metrics + recent runs', async () => {
    const skill = await seedSkill();
    const host = await seedHost({ linkSkillId: skill.id });
    const app = await appWith();
    await createSkillCase(app, skill.id);
    const started = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/eval-runs`,
      payload: { host_agent_id: host.id },
    });
    await pollSkillSuite(app, (started.json() as { suite_run_id: string }).suite_run_id);

    const res = await app.inject({ method: 'GET', url: '/skill-eval-dashboard' });
    expect(res.statusCode).toBe(200);
    const dash = res.json() as {
      skills: { skill_id: string; cases_total: number; current: { recall: number | null } }[];
      recent_runs: { skill_id: string }[];
    };
    const row = dash.skills.find((s) => s.skill_id === skill.id);
    expect(row).toBeTruthy();
    expect(row!.cases_total).toBe(1);
    expect(row!.current.recall).toBe(1);
    expect(dash.recent_runs.some((r) => r.skill_id === skill.id)).toBe(true);
  });

  // ---- T25 — compare two skill runs (test_skill_compare / AC-28/AC-29) ----
  it('compare: metric+cost deltas, skill bodies from skill_versions, host_changed flag', async () => {
    const skill = await seedSkill({ body: `Flag secrets v1. ${SKILL_MARKER}` });
    const host = await seedHost({ linkSkillId: skill.id });
    const app = await appWith();
    await createSkillCase(app, skill.id);

    const s1 = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/eval-runs`,
      payload: { host_agent_id: host.id },
    });
    await pollSkillSuite(app, (s1.json() as { suite_run_id: string }).suite_run_id);
    const s2 = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/eval-runs`,
      payload: { host_agent_id: host.id },
    });
    await pollSkillSuite(app, (s2.json() as { suite_run_id: string }).suite_run_id);

    const a = (s1.json() as { suite_run_id: string }).suite_run_id;
    const b = (s2.json() as { suite_run_id: string }).suite_run_id;
    const res = await app.inject({ method: 'GET', url: `/skill-eval-compare?a=${a}&b=${b}` });
    expect(res.statusCode).toBe(200);
    const cmp = res.json() as {
      skill_body_a: string | null;
      skill_body_b: string | null;
      host_changed: boolean;
      run_a: { host_agent_name: string | null };
    };
    expect(cmp.skill_body_a).toContain(SKILL_MARKER); // snapshotted body present
    expect(cmp.skill_body_b).toContain(SKILL_MARKER);
    expect(cmp.host_changed).toBe(false); // same host + version
    expect(cmp.run_a.host_agent_name).toBe(host.name);
  });

  // ---- T27 — host delete preserves skill suites; compare degrades (test_host_delete_preserves / AC-32) ----
  it('deleting the host agent preserves skill suites; compare degrades host name to null', async () => {
    const skill = await seedSkill();
    const host = await seedHost({ linkSkillId: skill.id });
    const app = await appWith();
    await createSkillCase(app, skill.id);

    const s1 = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/eval-runs`,
      payload: { host_agent_id: host.id },
    });
    const suite1 = (s1.json() as { suite_run_id: string }).suite_run_id;
    await pollSkillSuite(app, suite1);
    const s2 = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/eval-runs`,
      payload: { host_agent_id: host.id },
    });
    const suite2 = (s2.json() as { suite_run_id: string }).suite_run_id;
    await pollSkillSuite(app, suite2);

    // Delete the host agent (agent-cascade removes its OWN cases/suites only).
    const del = await app.inject({ method: 'DELETE', url: `/agents/${host.id}` });
    expect(del.statusCode).toBe(200);

    // The skill suites it hosted are preserved (host_agent_id carries no FK).
    const stillThere = await app.inject({ method: 'GET', url: `/skill-eval-runs/${suite1}` });
    expect(stillThere.statusCode).toBe(200);
    expect((stillThere.json() as { suite: { host_agent_id: string } }).suite.host_agent_id).toBe(
      host.id,
    );

    // Compare degrades: host name unavailable, but ids/versions + bodies survive.
    const cmp = await app.inject({ method: 'GET', url: `/skill-eval-compare?a=${suite1}&b=${suite2}` });
    expect(cmp.statusCode).toBe(200);
    const body = cmp.json() as { run_a: { host_agent_name: string | null; host_agent_id: string } };
    expect(body.run_a.host_agent_name).toBeNull();
    expect(body.run_a.host_agent_id).toBe(host.id);
  });

  // ---- T26 — skill-delete cascade (test_skill_cascade / AC-31) ----
  it('deleting a skill cascades its eval cases + differential suite history', async () => {
    const skill = await seedSkill();
    const host = await seedHost({ linkSkillId: skill.id });
    const app = await appWith();
    await createSkillCase(app, skill.id);
    const started = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/eval-runs`,
      payload: { host_agent_id: host.id },
    });
    const suiteId = (started.json() as { suite_run_id: string }).suite_run_id;
    await pollSkillSuite(app, suiteId);

    const del = await app.inject({ method: 'DELETE', url: `/skills/${skill.id}` });
    expect(del.statusCode).toBe(200);

    const cases = await db().select().from(t.evalCases).where(eq(t.evalCases.ownerId, skill.id));
    const suites = await db()
      .select()
      .from(t.evalSkillSuiteRuns)
      .where(eq(t.evalSkillSuiteRuns.skillId, skill.id));
    const runs = await db()
      .select()
      .from(t.evalRuns)
      .where(eq(t.evalRuns.skillSuiteRunId, suiteId));
    expect(cases).toHaveLength(0);
    expect(suites).toHaveLength(0);
    expect(runs).toHaveLength(0); // per-case rows cascaded via the FK
  });

  // ---- T28 — boot reaping (test_skill_reap / AC-22) ----
  it('boot reaping flips orphaned running skill suites to failed', async () => {
    const skill = await seedSkill();
    const host = await seedHost({ linkSkillId: skill.id });
    await db().insert(t.evalSkillSuiteRuns).values({
      workspaceId,
      skillId: skill.id,
      skillVersion: skill.version,
      hostAgentId: host.id,
      hostAgentVersion: host.version,
      status: 'running',
    });
    // A fresh boot reaps orphaned running skill suites.
    await appWith();
    const running = await db()
      .select()
      .from(t.evalSkillSuiteRuns)
      .where(
        and(eq(t.evalSkillSuiteRuns.skillId, skill.id), eq(t.evalSkillSuiteRuns.status, 'running')),
      );
    expect(running).toHaveLength(0);
  });
});
