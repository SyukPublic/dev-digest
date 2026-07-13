import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { LLMProvider, Review, SecretsProvider, StructuredRequest, StructuredResult } from '@devdigest/shared';
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
  console.warn('[skill-stability] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * Phase 5 (T15–T19) — the stability SERVICE + ROUTES. A stability group repeats
 * ONE frozen snapshot N times over the UNCHANGED differential executor, then the
 * pure aggregator reports variance + per-case flags + a noise-aware alert. The
 * deterministic marker-aware LLM (mirrors skill-eval.it) makes the WITH arm emit
 * the caused finding so each child run scores recall 1.
 * → AC-1, AC-2, AC-3, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10.
 */

const SKILL_MARKER = 'ZZZ_STABILITY_MARKER_STRIPE_SECRET';
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
  async listModels() {
    return [];
  }
  async complete(): Promise<never> {
    throw new Error('not used');
  }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const text = req.messages.map((m) => m.content).join('\n');
    const withSkill = text.includes(SKILL_MARKER);
    const review: Review = withSkill
      ? { verdict: 'request_changes', summary: 's', score: 42, findings: [{ ...CAUSED_FINDING }] }
      : { verdict: 'comment', summary: 'ok', score: 90, findings: [] };
    const parsed = req.schema.safeParse(review);
    if (!parsed.success) throw new Error(`fixture failed schema: ${parsed.error.message}`);
    return { data: parsed.data, model: req.model, tokensIn: 100, tokensOut: 50, costUsd: 0.001, raw: JSON.stringify(review), attempts: 1 };
  }
  async embed(texts: string[]) {
    return texts.map(() => []);
  }
}

/** Never resolves — keeps every child suite `running` so a burst of start requests
 * observes a STABLE "already running" 409 (used only for the rate-limit test; the
 * pending promise holds no timer, so it does not keep the test process alive). */
class HangingLLM implements LLMProvider {
  readonly id = 'openai' as const;
  async listModels() {
    return [];
  }
  async complete(): Promise<never> {
    throw new Error('not used');
  }
  completeStructured<T>(): Promise<StructuredResult<T>> {
    return new Promise<StructuredResult<T>>(() => undefined);
  }
  async embed(texts: string[]) {
    return texts.map(() => []);
  }
}

/** A secrets provider that resolves every key to `undefined` — forces
 * `container.llm('openai')` to throw `ConfigError` (no override key path used),
 * so a child suite's setup fails deterministically without a real LLM call. */
const NO_SECRETS: SecretsProvider = { get: async () => undefined };

let seq = 0;

d('Skill eval — stability layer (Testcontainers pg)', () => {
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

  function appWith(llm: LLMProvider = new SkillAwareLLM()): Promise<FastifyInstance> {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { git: new MockGitClient({}), llm: { openai: llm } },
    });
  }

  async function seedSkill(opts: { body?: string } = {}) {
    const body = opts.body ?? `Flag hardcoded secrets. ${SKILL_MARKER}`;
    const [skill] = await db()
      .insert(t.skills)
      .values({ workspaceId, name: `Skill ${seq++}`, description: 'x', type: 'custom', source: 'manual', body, enabled: true, version: 1 })
      .returning();
    await db().insert(t.skillVersions).values({ skillId: skill!.id, version: 1, body });
    return skill!;
  }

  async function seedHost(opts: { enabled?: boolean; linkSkillId?: string } = {}) {
    const [agent] = await db()
      .insert(t.agents)
      .values({ workspaceId, name: `Host ${seq++}`, provider: 'openai', model: 'gpt-4.1', systemPrompt: 'Review this diff.', enabled: opts.enabled ?? true, version: 3 })
      .returning();
    if (opts.linkSkillId) {
      await db().insert(t.agentSkills).values({ agentId: agent!.id, skillId: opts.linkSkillId, order: 0 });
    }
    return agent!;
  }

  async function createSkillCase(app: FastifyInstance, skillId: string, expected: unknown = { expectation: 'must_find', findings: [{ file: 'src/config.ts', start_line: 11, end_line: 11 }] }) {
    return app.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: { owner_kind: 'skill', owner_id: skillId, name: `case-${seq++}`, input_diff: CASE_DIFF, expected_output: expected },
    });
  }

  async function pollGroup(app: FastifyInstance, groupId: string, budgetMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < budgetMs) {
      const res = await app.inject({ method: 'GET', url: `/skill-stability-runs/${groupId}` });
      const body = res.json() as { group: { status: string } };
      if (body.group.status !== 'running') return body;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`stability group ${groupId} did not terminate within ${budgetMs}ms`);
  }

  // ---- T15/T16 — start group → repeat → variance summary + per-case flags ----
  it('start (n=2) → running id; group completes done; variance summary + case flags (AC-1/AC-3/AC-5)', async () => {
    const skill = await seedSkill();
    const host = await seedHost({ linkSkillId: skill.id });
    const app = await appWith();
    await createSkillCase(app, skill.id);

    const started = await app.inject({ method: 'POST', url: `/skills/${skill.id}/stability-runs`, payload: { host_agent_id: host.id, n: 2 } });
    expect(started.statusCode).toBe(200);
    const { group_id, status } = started.json() as { group_id: string; status: string };
    expect(status).toBe('running');

    const detail = await pollGroup(app, group_id);
    const group = detail.group as unknown as { status: string; n_requested: number; run_ids: string[]; skill_version: number };
    expect(group.status).toBe('done');
    expect(group.n_requested).toBe(2);
    expect(group.run_ids).toHaveLength(2);

    const summary = (detail as { summary: unknown }).summary as {
      recall: { mean: number; stddev: number; n: number; indicative: boolean } | null;
      runs_completed: number;
    };
    expect(summary).not.toBeNull();
    // Deterministic LLM → recall 1 both runs → mean 1, stddev 0, n 2.
    expect(summary.recall!.mean).toBe(1);
    expect(summary.recall!.stddev).toBe(0);
    expect(summary.recall!.n).toBe(2);
    expect(summary.recall!.indicative).toBe(true); // n=2 < STABILITY_MIN_N
    expect(summary.runs_completed).toBe(2);

    const cases = (detail as { cases: { case_id: string; pass_rate: number; flaky: boolean; non_discriminating: boolean; runs: number }[] }).cases;
    expect(cases).toHaveLength(1);
    expect(cases[0]!.runs).toBe(2);
    expect(cases[0]!.pass_rate).toBe(1); // unanimous pass
    expect(cases[0]!.flaky).toBe(false); // strict band: unanimous is never flaky
    expect(cases[0]!.non_discriminating).toBe(false); // the skill DID produce a delta
  });

  // ---- T19 — route validation (test_stability_routes / AC-9) ----
  it('n out of range → 422 (edge Zod); 409 when a group is already running; disabled host → 400', async () => {
    const skill = await seedSkill();
    const host = await seedHost({ linkSkillId: skill.id });
    const app = await appWith();
    await createSkillCase(app, skill.id);

    // n below 2 → 422 at the edge.
    const tooLow = await app.inject({ method: 'POST', url: `/skills/${skill.id}/stability-runs`, payload: { host_agent_id: host.id, n: 1 } });
    expect(tooLow.statusCode).toBe(422);
    // n above 5 → 422.
    const tooHigh = await app.inject({ method: 'POST', url: `/skills/${skill.id}/stability-runs`, payload: { host_agent_id: host.id, n: 6 } });
    expect(tooHigh.statusCode).toBe(422);

    // Insert a running group AFTER boot so it persists → 409.
    await db().insert(t.evalSkillStabilityGroups).values({
      workspaceId, skillId: skill.id, skillVersion: skill.version, hostAgentId: host.id, hostAgentVersion: host.version, nRequested: 2, status: 'running',
    });
    const conflict = await app.inject({ method: 'POST', url: `/skills/${skill.id}/stability-runs`, payload: { host_agent_id: host.id, n: 2 } });
    expect(conflict.statusCode).toBe(409);

    // Disabled host → 400.
    const disabled = await seedHost({ enabled: false });
    const skill2 = await seedSkill();
    const app2 = await appWith();
    await createSkillCase(app2, skill2.id);
    const badHost = await app2.inject({ method: 'POST', url: `/skills/${skill2.id}/stability-runs`, payload: { host_agent_id: disabled.id, n: 2 } });
    expect(badHost.statusCode).toBe(400);
  });

  it('zero cases → 400', async () => {
    const skill = await seedSkill();
    const host = await seedHost({ linkSkillId: skill.id });
    const app = await appWith();
    const zero = await app.inject({ method: 'POST', url: `/skills/${skill.id}/stability-runs`, payload: { host_agent_id: host.id, n: 2 } });
    expect(zero.statusCode).toBe(400);
  });

  // ---- T17 — dashboard extended with stability fields (test_skill_dashboard_stability / AC-10) ----
  it('per-skill dashboard carries stability summary + group + case_stability after a group runs', async () => {
    const skill = await seedSkill();
    const host = await seedHost({ linkSkillId: skill.id });
    const app = await appWith();
    await createSkillCase(app, skill.id);
    const started = await app.inject({ method: 'POST', url: `/skills/${skill.id}/stability-runs`, payload: { host_agent_id: host.id, n: 2 } });
    await pollGroup(app, (started.json() as { group_id: string }).group_id);

    const res = await app.inject({ method: 'GET', url: `/skills/${skill.id}/eval-dashboard` });
    expect(res.statusCode).toBe(200);
    const dash = res.json() as {
      stability: { recall: { n: number } | null } | null;
      stability_group: { n_requested: number } | null;
      case_stability: { case_id: string }[];
      stability_alert: unknown;
      alert: string | null;
    };
    expect(dash.stability_group?.n_requested).toBe(2);
    expect(dash.stability?.recall?.n).toBe(2);
    expect(dash.case_stability).toHaveLength(1);
    // No ≥1pt drop across the differential trend → no noise-aware alert.
    expect(dash.stability_alert).toBeNull();
  });

  // ---- T18 — boot reaping (test_stability_reap) ----
  it('boot reaping flips orphaned running stability groups to failed', async () => {
    const skill = await seedSkill();
    const host = await seedHost({ linkSkillId: skill.id });
    await db().insert(t.evalSkillStabilityGroups).values({
      workspaceId, skillId: skill.id, skillVersion: skill.version, hostAgentId: host.id, hostAgentVersion: host.version, nRequested: 5, status: 'running',
    });
    await appWith();
    const running = await db()
      .select()
      .from(t.evalSkillStabilityGroups)
      .where(and(eq(t.evalSkillStabilityGroups.skillId, skill.id), eq(t.evalSkillStabilityGroups.status, 'running')));
    expect(running).toHaveLength(0);
  });

  // ---- T18 — skill-delete cascade removes stability groups ----
  it('deleting a skill cascades its stability groups + child suite runs + per-case rows', async () => {
    const skill = await seedSkill();
    const host = await seedHost({ linkSkillId: skill.id });
    const app = await appWith();
    await createSkillCase(app, skill.id);
    const started = await app.inject({ method: 'POST', url: `/skills/${skill.id}/stability-runs`, payload: { host_agent_id: host.id, n: 2 } });
    const groupId = (started.json() as { group_id: string }).group_id;
    await pollGroup(app, groupId);

    const del = await app.inject({ method: 'DELETE', url: `/skills/${skill.id}` });
    expect(del.statusCode).toBe(200);

    const groups = await db().select().from(t.evalSkillStabilityGroups).where(eq(t.evalSkillStabilityGroups.skillId, skill.id));
    const suites = await db().select().from(t.evalSkillSuiteRuns).where(eq(t.evalSkillSuiteRuns.stabilityGroupId, groupId));
    expect(groups).toHaveLength(0);
    expect(suites).toHaveLength(0);
  });

  // ---- T14/T16 — AC-8: fewer than 2 completed children → group failed, no vacuous
  // stddev, and BOTH children were still attempted (per-run failure continues) ----
  it('AC-8: every child setup fails (no LLM key) → group failed; detail summary stays null; both children attempted', async () => {
    const skill = await seedSkill();
    const host = await seedHost({ linkSkillId: skill.id });
    // No `llm` override + a secrets provider that resolves every key to
    // `undefined` → `container.llm('openai')` throws ConfigError inside EVERY
    // child `SkillEvalRunExecutor.run` (a setup failure, not a per-case one) —
    // deterministically forces `completed.length === 0 < 2` without a real LLM call.
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { git: new MockGitClient({}), secrets: NO_SECRETS },
    });
    await createSkillCase(app, skill.id);

    const started = await app.inject({ method: 'POST', url: `/skills/${skill.id}/stability-runs`, payload: { host_agent_id: host.id, n: 2 } });
    expect(started.statusCode).toBe(200);
    const { group_id } = started.json() as { group_id: string };

    const detail = await pollGroup(app, group_id);
    const group = detail.group as unknown as { status: string; run_ids: string[] };
    // Per-run failure continues: the loop still inserted + attempted BOTH children
    // despite each one's setup failing.
    expect(group.run_ids).toHaveLength(2);
    // Fewer than 2 completed (0 here) → the group itself is `failed` (AC-8).
    expect(group.status).toBe('failed');

    const summary = (detail as { summary: unknown }).summary;
    // Never a vacuous stddev over < 2 samples — no variance is reported at all.
    expect(summary).toBeNull();
  });

  // ---- T19 — AC-9: the one-live-group guard holds under a BURST of requests ----
  // NOTE: `EVAL_RUN_RATE_LIMIT`'s 429 itself is NOT exercisable here — `app.ts`
  // deliberately skips registering `@fastify/rate-limit` under `NODE_ENV=test`
  // ("Disabled under test so integration suites can hammer endpoints via
  // inject()"), which also no-ops the per-route `config.rateLimit` override (the
  // plugin must be registered for a route's rateLimit config to take effect).
  // That is an intentional, pre-existing test-env behavior (not a gap this run
  // introduced) — no other route in this suite asserts a live 429 either. This
  // test instead proves the observable AC-9 behavior THAT IS reachable in-process:
  // a burst of concurrent start requests against one already-running group is
  // consistently rejected 409, never double-starting a second group.
  it('AC-9: a burst of concurrent stability-start requests all 409 while one group is already running', async () => {
    const skill = await seedSkill();
    const host = await seedHost({ linkSkillId: skill.id });
    // A hanging LLM keeps the group `running` for the whole burst so every
    // request deterministically observes "already running".
    const app = await appWith(new HangingLLM());
    await createSkillCase(app, skill.id);

    const first = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/stability-runs`,
      payload: { host_agent_id: host.id, n: 2 },
    });
    expect(first.statusCode).toBe(200);

    const burst = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.inject({
          method: 'POST',
          url: `/skills/${skill.id}/stability-runs`,
          payload: { host_agent_id: host.id, n: 2 },
        }),
      ),
    );
    expect(burst.map((r) => r.statusCode)).toEqual(Array(5).fill(409));

    // Only ONE group row exists for the skill — the burst never double-started.
    const groups = await db()
      .select()
      .from(t.evalSkillStabilityGroups)
      .where(eq(t.evalSkillStabilityGroups.skillId, skill.id));
    expect(groups).toHaveLength(1);
  });
});
