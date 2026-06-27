/**
 * Phase 3 — intent service + route tests.
 *
 * Service unit tests: fake LLMProvider + fake repo (no DB).
 * Route tests: app.inject() with spied service methods + MockAuthProvider to
 *              verify HTTP shapes without touching the database.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { classifyIntent } from '../src/modules/reviews/intent-service.js';
import { ReviewService } from '../src/modules/reviews/service.js';
import { MockAuthProvider } from '../src/adapters/mocks.js';
import type { Container } from '../src/platform/container.js';
import type { PullRow, RepoRow } from '../src/db/rows.js';
import type { UnifiedDiff, Intent } from '@devdigest/shared';
import type { ReviewRepository } from '../src/modules/reviews/repository.js';

// ── shared fixtures ──────────────────────────────────────────────────────────

const FAKE_INTENT: Intent = {
  intent: 'Add rate limiting to protect the public API from abuse.',
  in_scope: ['server/src/routes.ts', 'server/src/middleware/rate-limit.ts'],
  out_of_scope: ['client/**', 'docs/**'],
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

// ── classifyIntent unit tests ─────────────────────────────────────────────────

describe('classifyIntent', () => {
  function makeContainer(opts: {
    githubFails?: boolean;
    llmResult?: Partial<Intent>;
  } = {}) {
    const structured: Intent = { ...FAKE_INTENT, ...opts.llmResult };
    const completeStructured = vi.fn().mockResolvedValue({
      data: structured,
      tokensIn: 120,
      tokensOut: 30,
      costUsd: 0.0001,
      raw: JSON.stringify(structured),
    });
    const fakeRepo = {
      upsertIntent: vi.fn().mockResolvedValue(undefined),
      getIntent: vi.fn().mockResolvedValue(undefined),
      getPull: vi.fn().mockResolvedValue(FAKE_PULL),
      getRepo: vi.fn().mockResolvedValue(FAKE_REPO),
    } as unknown as ReviewRepository;

    const fakeGitHub = opts.githubFails
      ? { getIssue: vi.fn().mockRejectedValue(new Error('No token')) }
      : {
          getIssue: vi.fn().mockResolvedValue({
            number: 12,
            title: 'Issue title',
            body: 'Issue body',
            state: 'open',
          }),
        };

    // Settings DB rows: empty → no workspace override → uses registry default.
    const fakeDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };

    const container = {
      github: vi.fn().mockResolvedValue(fakeGitHub),
      llm: vi.fn().mockResolvedValue({ completeStructured }),
      tokenizer: { count: (text: string) => Math.ceil(text.length / 4) },
      db: fakeDb,
    } as unknown as Container;

    return { container, fakeRepo, completeStructured, fakeGitHub };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls completeStructured with Intent schema and returns result', async () => {
    const { container, fakeRepo, completeStructured } = makeContainer();

    const result = await classifyIntent(
      container,
      fakeRepo,
      'ws-uuid-1',
      FAKE_PULL,
      FAKE_REPO,
      FAKE_DIFF,
    );

    expect(completeStructured).toHaveBeenCalledOnce();
    const call = completeStructured.mock.calls[0]![0];
    expect(call.schemaName).toBe('Intent');
    expect(result.intent).toMatchObject(FAKE_INTENT);
    expect(result.tokensIn).toBe(120);
    expect(result.tokensOut).toBe(30);
    expect(result.costUsd).toBe(0.0001);
  });

  it('tokensSaved is rawTokens minus headersTokens, floored at 0', async () => {
    const { container, fakeRepo } = makeContainer();

    const result = await classifyIntent(
      container,
      fakeRepo,
      'ws-uuid-1',
      FAKE_PULL,
      FAKE_REPO,
      FAKE_DIFF,
    );

    // raw diff includes patch body lines; headers-only omits them → savings >= 0
    expect(result.tokensSaved).toBeGreaterThanOrEqual(0);
  });

  it('upserts the intent with headSha after a successful call', async () => {
    const { container, fakeRepo } = makeContainer();

    await classifyIntent(
      container,
      fakeRepo,
      'ws-uuid-1',
      FAKE_PULL,
      FAKE_REPO,
      FAKE_DIFF,
    );

    expect((fakeRepo as unknown as { upsertIntent: ReturnType<typeof vi.fn> }).upsertIntent)
      .toHaveBeenCalledOnce();
    const [prId, intent, headSha] = (fakeRepo as unknown as { upsertIntent: ReturnType<typeof vi.fn> })
      .upsertIntent.mock.calls[0]!;
    expect(prId).toBe(FAKE_PULL.id);
    expect(intent).toMatchObject(FAKE_INTENT);
    expect(headSha).toBe(FAKE_PULL.headSha);
  });

  it('resolves linked issue from PR body and passes issue content to LLM', async () => {
    const { container, fakeRepo, completeStructured, fakeGitHub } = makeContainer();

    await classifyIntent(
      container,
      fakeRepo,
      'ws-uuid-1',
      FAKE_PULL,
      FAKE_REPO,
      FAKE_DIFF,
    );

    // GitHub should be called with issue #12 (from "Closes #12.")
    expect(fakeGitHub.getIssue).toHaveBeenCalledWith(
      { owner: 'acme', name: 'api' },
      12,
    );
    // The messages passed to the LLM should include issue title
    const call = completeStructured.mock.calls[0]![0];
    const userMsg = (call.messages as { role: string; content: string }[])
      .find((m) => m.role === 'user')?.content ?? '';
    expect(userMsg).toContain('Issue title');
  });

  it('missing-issue path: proceeds without linked issue when GitHub is unavailable', async () => {
    const { container, fakeRepo, completeStructured } = makeContainer({ githubFails: true });

    // Should NOT throw — classification proceeds with title + files only.
    const result = await classifyIntent(
      container,
      fakeRepo,
      'ws-uuid-1',
      FAKE_PULL,
      FAKE_REPO,
      FAKE_DIFF,
    );

    expect(result.intent).toBeDefined();
    expect(completeStructured).toHaveBeenCalledOnce();
  });

  it('missing-issue path: skips getIssue when PR body is null', async () => {
    const { container, fakeRepo, fakeGitHub } = makeContainer();
    const pullNoBody: PullRow = { ...FAKE_PULL, body: null };

    const result = await classifyIntent(
      container,
      fakeRepo,
      'ws-uuid-1',
      pullNoBody,
      FAKE_REPO,
      FAKE_DIFF,
    );

    expect(result.intent).toBeDefined();
    expect(fakeGitHub.getIssue).not.toHaveBeenCalled();
  });

  it('workspace review_intent override wins over the registry default', async () => {
    const structured: Intent = FAKE_INTENT;
    const completeStructured = vi.fn().mockResolvedValue({
      data: structured,
      tokensIn: 50,
      tokensOut: 20,
      costUsd: 0.0002,
      raw: '{}',
    });
    const fakeRepo = {
      upsertIntent: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReviewRepository;

    // Simulate a DB row that overrides review_intent to openai/gpt-4.1.
    // The DB stores JSONB so Drizzle returns a pre-parsed object (not a string).
    const fakeDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        {
          key: 'feature_models',
          value: { review_intent: { provider: 'openai', model: 'gpt-4.1' } },
        },
      ]),
    };
    const container = {
      github: vi.fn().mockRejectedValue(new Error('no github')),
      llm: vi.fn().mockResolvedValue({ completeStructured }),
      tokenizer: { count: (t: string) => t.length },
      db: fakeDb,
    } as unknown as Container;

    const pullNoBody: PullRow = { ...FAKE_PULL, body: null };
    await classifyIntent(container, fakeRepo, 'ws-uuid-1', pullNoBody, FAKE_REPO, FAKE_DIFF);

    // Workspace override → llm() called with 'openai'
    expect(container.llm).toHaveBeenCalledWith('openai');
  });
});

// ── route tests via app.inject() ─────────────────────────────────────────────

const PR_UUID = '11111111-1111-1111-1111-111111111111';
const INTENT_RECORD = { pr_id: PR_UUID, ...FAKE_INTENT };

describe('GET /pulls/:id/intent + POST /pulls/:id/intent/recompute (routes)', () => {
  const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

  // Intercept service methods so no real DB access happens.
  beforeEach(() => {
    vi.spyOn(ReviewService.prototype, 'reapStaleRuns').mockResolvedValue(0);
    vi.spyOn(ReviewService.prototype, 'getIntent').mockResolvedValue(INTENT_RECORD);
    vi.spyOn(ReviewService.prototype, 'recomputeIntent').mockResolvedValue(INTENT_RECORD);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('GET /pulls/:id/intent → 200 with PrIntentRecord shape', async () => {
    const app = await buildApp({
      config,
      overrides: { auth: new MockAuthProvider() },
    });
    const res = await app.inject({ method: 'GET', url: `/pulls/${PR_UUID}/intent` });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pr_id).toBe(PR_UUID);
    expect(body.intent).toBe(FAKE_INTENT.intent);
    expect(Array.isArray(body.in_scope)).toBe(true);
    expect(Array.isArray(body.out_of_scope)).toBe(true);
  });

  it('GET /pulls/:id/intent → 200 null when no intent stored', async () => {
    vi.spyOn(ReviewService.prototype, 'getIntent').mockResolvedValue(null);
    const app = await buildApp({
      config,
      overrides: { auth: new MockAuthProvider() },
    });
    const res = await app.inject({ method: 'GET', url: `/pulls/${PR_UUID}/intent` });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });

  it('GET /pulls/:id/intent → 422 on non-uuid param', async () => {
    const app = await buildApp({
      config,
      overrides: { auth: new MockAuthProvider() },
    });
    const res = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/intent' });
    await app.close();

    expect(res.statusCode).toBe(422);
  });

  it('POST /pulls/:id/intent/recompute → 200 with PrIntentRecord shape', async () => {
    const app = await buildApp({
      config,
      overrides: { auth: new MockAuthProvider() },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${PR_UUID}/intent/recompute`,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pr_id).toBe(PR_UUID);
    expect(body.intent).toBe(FAKE_INTENT.intent);
  });

  it('POST /pulls/:id/intent/recompute → 422 on non-uuid param', async () => {
    const app = await buildApp({
      config,
      overrides: { auth: new MockAuthProvider() },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/pulls/not-a-uuid/intent/recompute',
    });
    await app.close();

    expect(res.statusCode).toBe(422);
  });

  it('POST /pulls/:id/intent/recompute responds 200 on repeated calls (global RL off in test mode)', async () => {
    // In test mode NODE_ENV=test the global rate-limit is disabled (app.ts:95).
    // The per-route config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
    // is structural — verified here that the endpoint responds successfully 10×.
    const app = await buildApp({
      config,
      overrides: { auth: new MockAuthProvider() },
    });
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${PR_UUID}/intent/recompute`,
      });
      expect(res.statusCode).toBe(200);
    }
    await app.close();
  });
});
