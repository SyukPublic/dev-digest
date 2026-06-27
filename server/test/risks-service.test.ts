/**
 * Phase 3 — risks service + route tests.
 *
 * Service unit tests: fake LLMProvider + fake repo (no DB).
 * Route tests: app.inject() with spied service methods + MockAuthProvider to
 *              verify HTTP shapes without touching the database.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { analyzeRisks } from '../src/modules/reviews/risks-service.js';
import { ReviewService } from '../src/modules/reviews/service.js';
import { MockAuthProvider } from '../src/adapters/mocks.js';
import type { Container } from '../src/platform/container.js';
import type { PullRow, RepoRow } from '../src/db/rows.js';
import type { UnifiedDiff, Risks } from '@devdigest/shared';
import type { ReviewRepository } from '../src/modules/reviews/repository.js';
import { risksFreshnessKey } from '../src/modules/reviews/freshness.js';
import { RISKS_PROMPT_VERSION } from '@devdigest/reviewer-core';
import { defaultFeatureModel } from '../src/modules/settings/feature-models.js';

// ── shared fixtures ──────────────────────────────────────────────────────────

const FAKE_RISKS: Risks = {
  risks: [
    {
      kind: 'auth',
      title: 'Unauthenticated rate-limit bypass',
      explanation: 'The new public route is registered before the auth barrier.',
      severity: 'high',
      file_refs: ['server/src/routes.ts'],
    },
    {
      kind: 'performance',
      title: 'Tight rate-limit window',
      explanation: 'A 1-minute window may starve legitimate bursts.',
      severity: 'low',
      file_refs: ['server/src/routes.ts'],
    },
  ],
};

const FAKE_DIFF: UnifiedDiff = {
  raw: `diff --git a/server/src/routes.ts b/server/src/routes.ts
--- a/server/src/routes.ts
+++ b/server/src/routes.ts
@@ -10,3 +10,5 @@
 export const app = Fastify();
+app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
 app.listen({ port: 3000 });`,
  files: [
    {
      path: 'server/src/routes.ts',
      additions: 1,
      deletions: 0,
      hunks: [
        {
          file: 'server/src/routes.ts',
          oldStart: 10,
          oldLines: 3,
          newStart: 10,
          newLines: 5,
          newLineNumbers: [10, 11, 12, 13, 14],
        },
      ],
    },
  ],
};

const FAKE_PULL: PullRow = {
  id: 'pr-uuid-1',
  workspaceId: 'ws-uuid-1',
  repoId: 'repo-uuid-1',
  number: 42,
  title: 'Add rate limiting',
  author: 'dev',
  branch: 'feat/rate-limit',
  base: 'main',
  headSha: 'abc123',
  lastReviewedSha: null,
  additions: 1,
  deletions: 0,
  filesCount: 1,
  status: 'needs_review',
  body: 'Closes #12.',
  openedAt: null,
  updatedAt: null,
};

const FAKE_REPO: RepoRow = {
  id: 'repo-uuid-1',
  workspaceId: 'ws-uuid-1',
  owner: 'acme',
  name: 'api',
  fullName: 'acme/api',
  defaultBranch: 'main',
  clonePath: null,
  lastPolledAt: null,
  createdBy: null,
  createdAt: new Date(),
};

// ── analyzeRisks unit tests ───────────────────────────────────────────────────

describe('analyzeRisks', () => {
  function makeContainer(opts: {
    storedIntent?: { intent: string; in_scope: string[]; out_of_scope: string[] } | undefined;
    overrideModel?: { provider: string; model: string };
  } = {}) {
    const completeStructured = vi.fn().mockResolvedValue({
      data: FAKE_RISKS,
      tokensIn: 220,
      tokensOut: 60,
      costUsd: 0.0003,
      raw: JSON.stringify(FAKE_RISKS),
    });
    const fakeRepo = {
      upsertRisks: vi.fn().mockResolvedValue(undefined),
      getRisks: vi.fn().mockResolvedValue(undefined),
      getIntent: vi.fn().mockResolvedValue(opts.storedIntent),
      getPull: vi.fn().mockResolvedValue(FAKE_PULL),
      getRepo: vi.fn().mockResolvedValue(FAKE_REPO),
    } as unknown as ReviewRepository;

    // Settings DB rows: empty → no workspace override → registry default; or an
    // override row when `overrideModel` is provided.
    const rows = opts.overrideModel
      ? [{ key: 'feature_models', value: { risk_brief: opts.overrideModel } }]
      : [];
    const fakeDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(rows),
    };

    const container = {
      llm: vi.fn().mockResolvedValue({ completeStructured }),
      tokenizer: { count: (text: string) => Math.ceil(text.length / 4) },
      db: fakeDb,
    } as unknown as Container;

    return { container, fakeRepo, completeStructured };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls completeStructured with the Risks schema and returns the result', async () => {
    const { container, fakeRepo, completeStructured } = makeContainer();

    const result = await analyzeRisks(
      container,
      fakeRepo,
      'ws-uuid-1',
      FAKE_PULL,
      FAKE_REPO,
      FAKE_DIFF,
    );

    expect(completeStructured).toHaveBeenCalledOnce();
    const call = completeStructured.mock.calls[0]![0];
    expect(call.schemaName).toBe('Risks');
    expect(result.risks).toMatchObject(FAKE_RISKS);
    expect(result.tokensIn).toBe(220);
    expect(result.tokensOut).toBe(60);
    expect(result.costUsd).toBe(0.0003);
  });

  it('upserts the risks with the PR head SHA after a successful call', async () => {
    const { container, fakeRepo } = makeContainer();

    await analyzeRisks(container, fakeRepo, 'ws-uuid-1', FAKE_PULL, FAKE_REPO, FAKE_DIFF);

    const upsertRisks = (fakeRepo as unknown as { upsertRisks: ReturnType<typeof vi.fn> }).upsertRisks;
    expect(upsertRisks).toHaveBeenCalledOnce();
    const [prId, risks, headSha] = upsertRisks.mock.calls[0]!;
    expect(prId).toBe(FAKE_PULL.id);
    expect(risks).toMatchObject(FAKE_RISKS);
    expect(headSha).toBe(FAKE_PULL.headSha);
  });

  it('anchors the prompt with the stored intent when present (best-effort)', async () => {
    const { container, fakeRepo, completeStructured } = makeContainer({
      storedIntent: {
        intent: 'Add rate limiting to protect the public API.',
        in_scope: ['server/src/routes.ts'],
        out_of_scope: ['docs/**'],
      },
    });

    await analyzeRisks(container, fakeRepo, 'ws-uuid-1', FAKE_PULL, FAKE_REPO, FAKE_DIFF);

    const call = completeStructured.mock.calls[0]![0];
    const userMsg =
      (call.messages as { role: string; content: string }[]).find((m) => m.role === 'user')
        ?.content ?? '';
    // The compact intent rendering is injected (wrapped as untrusted "intent").
    expect(userMsg).toContain('Add rate limiting to protect the public API.');
    expect(userMsg).toContain('intent');
  });

  it('omits intent anchoring when no stored intent exists', async () => {
    const { container, fakeRepo, completeStructured } = makeContainer({ storedIntent: undefined });

    await analyzeRisks(container, fakeRepo, 'ws-uuid-1', FAKE_PULL, FAKE_REPO, FAKE_DIFF);

    const call = completeStructured.mock.calls[0]![0];
    const userMsg =
      (call.messages as { role: string; content: string }[]).find((m) => m.role === 'user')
        ?.content ?? '';
    expect(userMsg).not.toContain('source="intent"');
  });

  it('workspace risk_brief override wins over the registry default', async () => {
    const { container, fakeRepo } = makeContainer({
      overrideModel: { provider: 'anthropic', model: 'claude-3-7-sonnet' },
    });

    await analyzeRisks(container, fakeRepo, 'ws-uuid-1', FAKE_PULL, FAKE_REPO, FAKE_DIFF);

    // Default is openrouter/deepseek-v4-flash; the override resolves the provider to anthropic.
    expect(container.llm).toHaveBeenCalledWith('anthropic');
  });

  it('uses the registry default (openrouter) when no workspace override exists', async () => {
    const { container, fakeRepo } = makeContainer();

    await analyzeRisks(container, fakeRepo, 'ws-uuid-1', FAKE_PULL, FAKE_REPO, FAKE_DIFF);

    expect(container.llm).toHaveBeenCalledWith('openrouter');
  });

  // Stage 1 acceptance: analyzeRisks passes a 4th arg (freshnessKey) to upsertRisks.
  it('upsertRisks is called with a 4th freshness key (non-empty string)', async () => {
    const { container, fakeRepo } = makeContainer();

    await analyzeRisks(container, fakeRepo, 'ws-uuid-1', FAKE_PULL, FAKE_REPO, FAKE_DIFF);

    const upsertRisks = (fakeRepo as unknown as { upsertRisks: ReturnType<typeof vi.fn> }).upsertRisks;
    expect(upsertRisks).toHaveBeenCalledOnce();
    const call = upsertRisks.mock.calls[0]!;
    const freshnessKey = call[3]; // 4th arg: prId, risks, headSha, freshnessKey
    expect(typeof freshnessKey).toBe('string');
    expect((freshnessKey as string).length).toBeGreaterThan(0);
  });

  // The 4th arg must equal risksFreshnessKey computed from the same inputs
  // (default model + stored intent's freshnessKey which is undefined → empty string).
  it('upsertRisks 4th arg matches risksFreshnessKey computed from the same inputs', async () => {
    const { container, fakeRepo } = makeContainer(); // storedIntent = undefined → intentKey = ''

    await analyzeRisks(container, fakeRepo, 'ws-uuid-1', FAKE_PULL, FAKE_REPO, FAKE_DIFF);

    const upsertRisks = (fakeRepo as unknown as { upsertRisks: ReturnType<typeof vi.fn> }).upsertRisks;
    const call = upsertRisks.mock.calls[0]!;
    const storedKey = call[3] as string;

    // Recompute using the same inputs the service uses.
    const { provider, model } = defaultFeatureModel('risk_brief');
    const expectedKey = risksFreshnessKey({
      headSha: FAKE_PULL.headSha,
      base: FAKE_PULL.base,
      title: FAKE_PULL.title,
      body: FAKE_PULL.body ?? '',
      provider,
      model,
      promptVersion: RISKS_PROMPT_VERSION,
      intentKey: '', // storedIntent is undefined → storedIntent?.freshnessKey ?? '' = ''
    });

    expect(storedKey).toBe(expectedKey);
  });

  // When a stored intent has a freshnessKey, that key feeds into the risks key.
  // Changing the stored intent's freshnessKey changes the risks freshness key.
  it('risks freshness key changes when the stored intent freshnessKey changes', async () => {
    const storedIntentBase: { intent: string; in_scope: string[]; out_of_scope: string[] } = {
      intent: 'Add rate limiting to protect the public API.',
      in_scope: ['server/src/routes.ts'],
      out_of_scope: ['docs/**'],
    };

    // First call: storedIntent has no freshnessKey (undefined) → intentKey = ''
    const { container: c1, fakeRepo: r1 } = makeContainer({ storedIntent: storedIntentBase });
    await analyzeRisks(c1, r1, 'ws-uuid-1', FAKE_PULL, FAKE_REPO, FAKE_DIFF);
    const key1 = (r1 as unknown as { upsertRisks: ReturnType<typeof vi.fn> }).upsertRisks.mock.calls[0]![3] as string;

    vi.clearAllMocks();

    // Second call: storedIntent has a specific freshnessKey → intentKey = 'specific-key'
    // We need to extend the makeContainer to accept a freshnessKey on storedIntent.
    // Use a fresh fakeRepo with the extended stored intent.
    const fakeRepo2 = {
      upsertRisks: vi.fn().mockResolvedValue(undefined),
      getRisks: vi.fn().mockResolvedValue(undefined),
      getIntent: vi.fn().mockResolvedValue({ ...storedIntentBase, headSha: null, freshnessKey: 'specific-intent-key' }),
      getPull: vi.fn().mockResolvedValue(FAKE_PULL),
      getRepo: vi.fn().mockResolvedValue(FAKE_REPO),
    } as unknown as ReviewRepository;
    const fakeDb2 = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    const c2 = {
      llm: vi.fn().mockResolvedValue({
        completeStructured: vi.fn().mockResolvedValue({
          data: FAKE_RISKS,
          tokensIn: 220,
          tokensOut: 60,
          costUsd: 0.0003,
          raw: JSON.stringify(FAKE_RISKS),
        }),
      }),
      tokenizer: { count: (text: string) => Math.ceil(text.length / 4) },
      db: fakeDb2,
    } as unknown as Container;

    await analyzeRisks(c2, fakeRepo2, 'ws-uuid-1', FAKE_PULL, FAKE_REPO, FAKE_DIFF);
    const key2 = (fakeRepo2 as unknown as { upsertRisks: ReturnType<typeof vi.fn> }).upsertRisks.mock.calls[0]![3] as string;

    // The two keys must differ because the intentKey part differs.
    expect(key1).not.toBe(key2);
  });
});

// ── ReviewService.getRisks — is_stale derivation (Stage 1 acceptance) ────────
//
// getRisks derives is_stale on READ, analogous to getIntent (see intent-service.test.ts).

describe('ReviewService.getRisks — is_stale flag', () => {
  const FAKE_RISKS_DATA: Risks = {
    risks: [
      { kind: 'auth', title: 'Auth bypass', explanation: 'No auth check.', severity: 'high', file_refs: ['a.ts'] },
    ],
  };

  const STORED_INTENT_NO_KEY = {
    intent: 'Add rate limiting to protect the public API.',
    in_scope: ['server/src/routes.ts'],
    out_of_scope: ['docs/**'],
    headSha: FAKE_PULL.headSha,
    freshnessKey: null as string | null,
  };

  function makeServiceContainer(): Container {
    const fakeDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    return {
      db: fakeDb,
      runBus: { publish: vi.fn(), complete: vi.fn(), cancel: vi.fn(), isCancelled: vi.fn().mockReturnValue(false), buffer: vi.fn().mockReturnValue([]), subscribe: vi.fn() },
      llm: vi.fn(),
      agentsRepo: { listEnabled: vi.fn(), getById: vi.fn(), linkedSkills: vi.fn() },
      tokenizer: { count: (t: string) => Math.ceil(t.length / 4) },
      repoIntel: { getCallerSignatures: vi.fn(), getRepoMap: vi.fn(), getFileRank: vi.fn() },
    } as unknown as Container;
  }

  // Compute current risks key with a given intentKey.
  function computeCurrentRisksKey(intentKey = ''): string {
    const { provider, model } = defaultFeatureModel('risk_brief');
    return risksFreshnessKey({
      headSha: FAKE_PULL.headSha,
      base: FAKE_PULL.base,
      title: FAKE_PULL.title,
      body: FAKE_PULL.body ?? '',
      provider,
      model,
      promptVersion: RISKS_PROMPT_VERSION,
      intentKey,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Intention: stored key == current key → is_stale === false.
  it('is_stale is false when stored freshnessKey matches the current key', async () => {
    const currentKey = computeCurrentRisksKey(); // intentKey = '' (null stored intent key)
    const container = makeServiceContainer();
    const service = new ReviewService(container);

    vi.spyOn((service as unknown as { repo: { getPull: () => unknown } }).repo, 'getPull')
      .mockResolvedValue(FAKE_PULL);
    vi.spyOn((service as unknown as { repo: { getRisks: () => unknown } }).repo, 'getRisks')
      .mockResolvedValue({ ...FAKE_RISKS_DATA, headSha: FAKE_PULL.headSha, freshnessKey: currentKey });
    vi.spyOn((service as unknown as { repo: { getIntent: () => unknown } }).repo, 'getIntent')
      .mockResolvedValue(STORED_INTENT_NO_KEY);

    const result = await service.getRisks('ws-uuid-1', FAKE_PULL.id);
    expect(result).not.toBeNull();
    expect(result!.is_stale).toBe(false);
  });

  // Intention: stored key != current key → is_stale === true.
  it('is_stale is true when stored freshnessKey differs from the current key', async () => {
    const container = makeServiceContainer();
    const service = new ReviewService(container);

    vi.spyOn((service as unknown as { repo: { getPull: () => unknown } }).repo, 'getPull')
      .mockResolvedValue(FAKE_PULL);
    vi.spyOn((service as unknown as { repo: { getRisks: () => unknown } }).repo, 'getRisks')
      .mockResolvedValue({ ...FAKE_RISKS_DATA, headSha: 'sha-old', freshnessKey: 'old-stale-key' });
    vi.spyOn((service as unknown as { repo: { getIntent: () => unknown } }).repo, 'getIntent')
      .mockResolvedValue(STORED_INTENT_NO_KEY);

    const result = await service.getRisks('ws-uuid-1', FAKE_PULL.id);
    expect(result).not.toBeNull();
    expect(result!.is_stale).toBe(true);
  });

  // Intention: stored freshnessKey == null (legacy row) → is_stale === false.
  it('is_stale is false when stored freshnessKey is null (legacy row)', async () => {
    const container = makeServiceContainer();
    const service = new ReviewService(container);

    vi.spyOn((service as unknown as { repo: { getPull: () => unknown } }).repo, 'getPull')
      .mockResolvedValue(FAKE_PULL);
    vi.spyOn((service as unknown as { repo: { getRisks: () => unknown } }).repo, 'getRisks')
      .mockResolvedValue({ ...FAKE_RISKS_DATA, headSha: FAKE_PULL.headSha, freshnessKey: null });
    vi.spyOn((service as unknown as { repo: { getIntent: () => unknown } }).repo, 'getIntent')
      .mockResolvedValue(STORED_INTENT_NO_KEY);

    const result = await service.getRisks('ws-uuid-1', FAKE_PULL.id);
    expect(result).not.toBeNull();
    expect(result!.is_stale).toBe(false);
  });

  // Intention: stale_reason is never set (Stage 1 spec).
  it('stale_reason is never set on the returned record', async () => {
    const container = makeServiceContainer();
    const service = new ReviewService(container);

    vi.spyOn((service as unknown as { repo: { getPull: () => unknown } }).repo, 'getPull')
      .mockResolvedValue(FAKE_PULL);
    vi.spyOn((service as unknown as { repo: { getRisks: () => unknown } }).repo, 'getRisks')
      .mockResolvedValue({ ...FAKE_RISKS_DATA, headSha: 'sha-old', freshnessKey: 'stale-key' });
    vi.spyOn((service as unknown as { repo: { getIntent: () => unknown } }).repo, 'getIntent')
      .mockResolvedValue(STORED_INTENT_NO_KEY);

    const result = await service.getRisks('ws-uuid-1', FAKE_PULL.id);
    expect(result).not.toBeNull();
    expect(result!.stale_reason).toBeUndefined();
  });

  // Intention: when the stored intent's freshnessKey changes, getRisks reflects different
  // staleness (the current risks key folds in the intent's key).
  it('changing the stored intent freshnessKey shifts the current risks key (risks go stale)', async () => {
    // Scenario: risks were stored with intentKey='key-A', but stored intent now has
    // a different freshnessKey='key-B'. The current key re-derived with 'key-B' ≠ stored key.
    const storedIntentKeyA = 'intent-key-A';
    const storedIntentKeyB = 'intent-key-B';

    // Compute the risks key that was stored when intentKey was 'key-A'.
    const storedRisksKey = computeCurrentRisksKey(storedIntentKeyA);

    // Now the stored intent has a different freshnessKey ('key-B').
    // The recomputed current key will use 'key-B' → different → stale.
    const container = makeServiceContainer();
    const service = new ReviewService(container);

    vi.spyOn((service as unknown as { repo: { getPull: () => unknown } }).repo, 'getPull')
      .mockResolvedValue(FAKE_PULL);
    vi.spyOn((service as unknown as { repo: { getRisks: () => unknown } }).repo, 'getRisks')
      .mockResolvedValue({ ...FAKE_RISKS_DATA, headSha: FAKE_PULL.headSha, freshnessKey: storedRisksKey });
    vi.spyOn((service as unknown as { repo: { getIntent: () => unknown } }).repo, 'getIntent')
      .mockResolvedValue({ ...STORED_INTENT_NO_KEY, freshnessKey: storedIntentKeyB }); // changed!

    const result = await service.getRisks('ws-uuid-1', FAKE_PULL.id);
    expect(result).not.toBeNull();
    // Risks stored with intent-key-A are stale now that the intent has key-B.
    expect(result!.is_stale).toBe(true);
  });
});

// ── route tests via app.inject() ─────────────────────────────────────────────

const PR_UUID = '22222222-2222-2222-2222-222222222222';
const RISKS_RECORD = { pr_id: PR_UUID, risks: FAKE_RISKS.risks };

describe('GET /pulls/:id/risks + POST /pulls/:id/risks/recompute (routes)', () => {
  const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

  // Intercept service methods so no real DB access happens.
  beforeEach(() => {
    vi.spyOn(ReviewService.prototype, 'reapStaleRuns').mockResolvedValue(0);
    vi.spyOn(ReviewService.prototype, 'getRisks').mockResolvedValue(RISKS_RECORD);
    vi.spyOn(ReviewService.prototype, 'recomputeRisks').mockResolvedValue(RISKS_RECORD);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('GET /pulls/:id/risks → 200 with PrRisksRecord shape', async () => {
    const app = await buildApp({ config, overrides: { auth: new MockAuthProvider() } });
    const res = await app.inject({ method: 'GET', url: `/pulls/${PR_UUID}/risks` });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pr_id).toBe(PR_UUID);
    expect(Array.isArray(body.risks)).toBe(true);
    expect(body.risks[0].severity).toBe('high');
  });

  it('GET /pulls/:id/risks → 200 null when no risks stored', async () => {
    vi.spyOn(ReviewService.prototype, 'getRisks').mockResolvedValue(null);
    const app = await buildApp({ config, overrides: { auth: new MockAuthProvider() } });
    const res = await app.inject({ method: 'GET', url: `/pulls/${PR_UUID}/risks` });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });

  it('GET /pulls/:id/risks → 422 on non-uuid param', async () => {
    const app = await buildApp({ config, overrides: { auth: new MockAuthProvider() } });
    const res = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/risks' });
    await app.close();

    expect(res.statusCode).toBe(422);
  });

  it('POST /pulls/:id/risks/recompute → 200 with PrRisksRecord shape', async () => {
    const app = await buildApp({ config, overrides: { auth: new MockAuthProvider() } });
    const res = await app.inject({ method: 'POST', url: `/pulls/${PR_UUID}/risks/recompute` });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pr_id).toBe(PR_UUID);
    expect(Array.isArray(body.risks)).toBe(true);
  });

  it('POST /pulls/:id/risks/recompute → 422 on non-uuid param', async () => {
    const app = await buildApp({ config, overrides: { auth: new MockAuthProvider() } });
    const res = await app.inject({ method: 'POST', url: '/pulls/not-a-uuid/risks/recompute' });
    await app.close();

    expect(res.statusCode).toBe(422);
  });

  it('POST /pulls/:id/risks/recompute responds 200 on repeated calls (global RL off in test mode)', async () => {
    // In test mode the global rate-limit is disabled; the per-route config
    // { rateLimit: { max: 10, timeWindow: '1 minute' } } is structural — verified
    // here that the endpoint responds successfully across 10 calls.
    const app = await buildApp({ config, overrides: { auth: new MockAuthProvider() } });
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({ method: 'POST', url: `/pulls/${PR_UUID}/risks/recompute` });
      expect(res.statusCode).toBe(200);
    }
    await app.close();
  });
});
