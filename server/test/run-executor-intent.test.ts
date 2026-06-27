/**
 * Phase 4+5 — run-executor intent wiring unit tests.
 *
 * Asserts:
 * (a) ONE classify call across N agents when intent absent.
 * (b) NO classify call when stored.headSha === pull.headSha (fresh).
 * (c) Recompute when headSha differs (stale).
 * (d) Review proceeds when classify throws (best-effort).
 * (e) assembly.tokens.intent_tokens_saved present after a compute, absent after skip.
 * (f) Each agent prompt carries the intent section (assembly.intent non-null).
 *
 * No DB, no real LLM, no real diff loader — all fakes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import type { Container } from '../src/platform/container.js';
import type { PullRow, RepoRow, AgentRow } from '../src/db/rows.js';
import type { ReviewRepository } from '../src/modules/reviews/repository.js';
import type { Intent, UnifiedDiff } from '@devdigest/shared';
import { RunBus } from '../src/platform/sse.js';
import { intentFreshnessKey } from '../src/modules/reviews/freshness.js';
import { INTENT_PROMPT_VERSION } from '@devdigest/reviewer-core';
import { defaultFeatureModel } from '../src/modules/settings/feature-models.js';

// ── vi.mock must be hoisted ───────────────────────────────────────────────────

vi.mock('../src/modules/reviews/diff-loader.js', () => ({
  loadDiff: vi.fn(),
}));

vi.mock('../src/modules/reviews/intent-service.js', () => ({
  classifyIntent: vi.fn(),
}));

vi.mock('@devdigest/reviewer-core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@devdigest/reviewer-core')>();
  return {
    ...original,
    reviewPullRequest: vi.fn(),
  };
});

// ── import after vi.mock so the mocks are in effect ──────────────────────────

import { loadDiff } from '../src/modules/reviews/diff-loader.js';
import { classifyIntent } from '../src/modules/reviews/intent-service.js';
import { reviewPullRequest } from '@devdigest/reviewer-core';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const FAKE_INTENT: Intent = {
  intent: 'Add rate limiting',
  in_scope: ['server/src/routes.ts'],
  out_of_scope: ['client/**'],
};

const FAKE_DIFF: UnifiedDiff = {
  raw: 'diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1,3 +1,5 @@\n export const x = 1;\n+export const y = 2;',
  files: [
    {
      path: 'x.ts',
      additions: 1,
      deletions: 0,
      hunks: [
        {
          file: 'x.ts',
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 5,
          newLineNumbers: [1, 2, 3, 4, 5],
        },
      ],
    },
  ],
};

const FAKE_PULL: PullRow = {
  id: 'pr-1',
  workspaceId: 'ws-1',
  repoId: 'repo-1',
  number: 10,
  title: 'Add rate limiting',
  author: 'dev',
  branch: 'feat/rl',
  base: 'main',
  headSha: 'sha-current',
  lastReviewedSha: null,
  additions: 1,
  deletions: 0,
  filesCount: 1,
  status: 'needs_review',
  body: null,
  openedAt: null,
  updatedAt: null,
};

const FAKE_REPO: RepoRow = {
  id: 'repo-1',
  workspaceId: 'ws-1',
  owner: 'acme',
  name: 'api',
  fullName: 'acme/api',
  defaultBranch: 'main',
  clonePath: null,
  lastPolledAt: null,
  createdBy: null,
  createdAt: new Date(),
};

function makeAgent(id = 'agent-1'): AgentRow {
  return {
    id,
    workspaceId: 'ws-1',
    name: `Agent ${id}`,
    systemPrompt: 'You are a reviewer.',
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
    version: 1,
    enabled: true,
    repoIntel: false,
    ciFailOn: 'critical',
    strategy: 'single-pass',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as AgentRow;
}

/** Minimal fake ReviewOutcome (from reviewPullRequest mock). */
function makeFakeOutcome(intentText: string | null = null) {
  return {
    review: {
      findings: [],
      verdict: 'approved',
      summary: 'Looks good',
      score: 95,
    },
    grounding: '0/0 passed',
    dropped: [],
    mode: 'single-pass',
    assembly: {
      system: 'sys',
      skills: null,
      memory: null,
      specs: null,
      callers: null,
      repo_map: null,
      pr_description: null,
      user: 'user text',
      // Set only when intent was passed — the real assemblePrompt sets this.
      intent: intentText,
    },
    chunks: [{ label: 'all files' }],
    tokensIn: 100,
    tokensOut: 50,
    costUsd: 0.001,
    raw: '{}',
  };
}

/** Build a fake container (no real LLM; db stub returns [] so resolveFeatureModel falls back to default). */
function makeContainer(bus: RunBus): Container {
  // Settings DB stub: no rows → resolveFeatureModel falls back to defaultFeatureModel('review_intent').
  // The chain used by getFeatureModelOverride: container.db.select({...}).from(...).where(...) → [].
  const fakeDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  };
  return {
    runBus: bus,
    tokenizer: { count: (t: string) => Math.ceil(t.length / 4) },
    db: fakeDb,
    llm: vi.fn().mockResolvedValue({
      completeStructured: vi.fn().mockResolvedValue({
        data: FAKE_INTENT,
        tokensIn: 10,
        tokensOut: 5,
        costUsd: 0.0001,
        raw: '{}',
      }),
    }),
    repoIntel: {
      getCallerSignatures: vi.fn().mockResolvedValue([]),
      getRepoMap: vi.fn().mockResolvedValue({ degraded: true, text: '', tokens: 0, cached: false }),
      getFileRank: vi.fn().mockResolvedValue([]),
    },
  } as unknown as Container;
}

/** Build a fake ReviewRepository. */
function makeRepo(opts: {
  storedIntent?: ({ headSha: string | null; freshnessKey: string | null } & Intent) | null;
} = {}): ReviewRepository {
  return {
    getIntent: vi.fn().mockResolvedValue(opts.storedIntent ?? undefined),
    upsertIntent: vi.fn().mockResolvedValue(undefined),
    insertReview: vi.fn().mockResolvedValue({ id: 'review-1' }),
    insertFindings: vi.fn().mockResolvedValue([]),
    completeAgentRun: vi.fn().mockResolvedValue(undefined),
    saveRunTrace: vi.fn().mockResolvedValue(undefined),
    markReviewed: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReviewRepository;
}

/** Build a fake agents repo. */
function makeAgentsRepo() {
  return {
    linkedSkills: vi.fn().mockResolvedValue([]),
  } as unknown as Container['agentsRepo'];
}

// ── Helper ────────────────────────────────────────────────────────────────────

/** Run executeRuns with the given agents (default: 2). */
async function runWithAgents(
  agents: AgentRow[],
  repo: ReviewRepository,
  bus: RunBus,
  container: Container,
) {
  const executor = new ReviewRunExecutor(container, repo, makeAgentsRepo());
  const jobs = agents.map((agent, i) => ({ agent, runId: `run-${i}` }));

  // Pre-register run buffers so the bus doesn't crash on publish.
  for (const j of jobs) bus.publish(j.runId, 'info', 'init');

  await executor.executeRuns('ws-1', FAKE_PULL, FAKE_REPO, jobs);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ReviewRunExecutor — intent wiring (Phase 4+5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: diff loads successfully.
    vi.mocked(loadDiff).mockResolvedValue(FAKE_DIFF);

    // Default: classify succeeds with token savings.
    vi.mocked(classifyIntent).mockResolvedValue({
      intent: FAKE_INTENT,
      tokensSaved: 200,
      tokensIn: 50,
      tokensOut: 20,
      costUsd: 0.0002,
    });

    // Default: reviewPullRequest succeeds (intent set based on input).
    vi.mocked(reviewPullRequest).mockImplementation(async (input) => {
      const intentText = input.intent ?? null;
      return makeFakeOutcome(intentText) as ReturnType<typeof reviewPullRequest> extends Promise<infer T> ? T : never;
    });
  });

  // (a) ONE classify call across N agents when intent is absent.
  it('(a) classifyIntent called exactly once for 3 agents when no stored intent', async () => {
    const repo = makeRepo({ storedIntent: undefined });
    const bus = new RunBus();
    const container = makeContainer(bus);

    const agents = [makeAgent('a1'), makeAgent('a2'), makeAgent('a3')];
    await runWithAgents(agents, repo, bus, container);

    expect(vi.mocked(classifyIntent)).toHaveBeenCalledTimes(1);
  });

  // (b) NO classify call when the stored freshness key matches the current key (fresh).
  // The gate now checks the FULL freshness key, not just headSha.
  it('(b) classifyIntent NOT called when stored intent is fresh (freshnessKey matches)', async () => {
    // Compute the exact key the gate will derive from FAKE_PULL + defaultFeatureModel + INTENT_PROMPT_VERSION.
    const { provider, model } = defaultFeatureModel('review_intent');
    const currentKey = intentFreshnessKey({
      headSha: FAKE_PULL.headSha,
      base: FAKE_PULL.base,
      title: FAKE_PULL.title,
      body: FAKE_PULL.body ?? '',
      provider,
      model,
      promptVersion: INTENT_PROMPT_VERSION,
    });
    const repo = makeRepo({
      storedIntent: { ...FAKE_INTENT, headSha: FAKE_PULL.headSha, freshnessKey: currentKey },
    });
    const bus = new RunBus();
    const container = makeContainer(bus);

    await runWithAgents([makeAgent('a1'), makeAgent('a2')], repo, bus, container);

    expect(vi.mocked(classifyIntent)).not.toHaveBeenCalled();
  });

  // (c) Recompute when the stored freshness key differs from the current key (stale).
  // The gate: stale = !stored || stored.freshnessKey == null || stored.freshnessKey !== currentKey.
  it('(c) classifyIntent called when stored freshnessKey differs (stale)', async () => {
    const repo = makeRepo({
      storedIntent: { ...FAKE_INTENT, headSha: 'sha-old', freshnessKey: 'stale-key' }, // != currentKey
    });
    const bus = new RunBus();
    const container = makeContainer(bus);

    await runWithAgents([makeAgent('a1')], repo, bus, container);

    expect(vi.mocked(classifyIntent)).toHaveBeenCalledTimes(1);
  });

  // (d) Review proceeds when classify throws.
  it('(d) review proceeds normally when classifyIntent throws (best-effort)', async () => {
    vi.mocked(classifyIntent).mockRejectedValue(new Error('LLM unavailable'));

    const repo = makeRepo({ storedIntent: undefined });
    const bus = new RunBus();
    const container = makeContainer(bus);

    // Should not throw — review still runs for both agents.
    await expect(
      runWithAgents([makeAgent('a1'), makeAgent('a2')], repo, bus, container),
    ).resolves.not.toThrow();

    // reviewPullRequest was still called for each agent (no intent).
    expect(vi.mocked(reviewPullRequest)).toHaveBeenCalledTimes(2);
  });

  // (e) intent_tokens_saved present after a compute, absent after a fresh-skip.
  it('(e) assembly.tokens.intent_tokens_saved present after classify, absent on skip', async () => {
    // Case 1: classify ran (intent absent → stale).
    const repo1 = makeRepo({ storedIntent: undefined });
    const bus1 = new RunBus();
    const container1 = makeContainer(bus1);
    await runWithAgents([makeAgent('a1')], repo1, bus1, container1);

    const savedTrace1 = vi.mocked(repo1.saveRunTrace).mock.calls[0]?.[1];
    expect(savedTrace1?.prompt_assembly.tokens?.intent_tokens_saved).toBe(200);

    // Case 2: fresh-skip (freshnessKey matches) → no classify → no intent_tokens_saved.
    vi.clearAllMocks();
    vi.mocked(loadDiff).mockResolvedValue(FAKE_DIFF);
    vi.mocked(reviewPullRequest).mockImplementation(async (input) => {
      return makeFakeOutcome(input.intent ?? null) as ReturnType<typeof reviewPullRequest> extends Promise<infer T> ? T : never;
    });

    // Compute the exact current key so the gate considers the intent fresh.
    const { provider: p2, model: m2 } = defaultFeatureModel('review_intent');
    const freshKey2 = intentFreshnessKey({
      headSha: FAKE_PULL.headSha,
      base: FAKE_PULL.base,
      title: FAKE_PULL.title,
      body: FAKE_PULL.body ?? '',
      provider: p2,
      model: m2,
      promptVersion: INTENT_PROMPT_VERSION,
    });
    const repo2 = makeRepo({
      storedIntent: { ...FAKE_INTENT, headSha: FAKE_PULL.headSha, freshnessKey: freshKey2 },
    });
    const bus2 = new RunBus();
    const container2 = makeContainer(bus2);
    await runWithAgents([makeAgent('a1')], repo2, bus2, container2);

    const savedTrace2 = vi.mocked(repo2.saveRunTrace).mock.calls[0]?.[1];
    expect(savedTrace2?.prompt_assembly.tokens?.intent_tokens_saved).toBeUndefined();
  });

  // (f) Each agent prompt carries the intent section.
  it('(f) each agent prompt carries the intent section when intent is computed', async () => {
    const repo = makeRepo({ storedIntent: undefined }); // will classify
    const bus = new RunBus();
    const container = makeContainer(bus);

    const agents = [makeAgent('a1'), makeAgent('a2')];
    await runWithAgents(agents, repo, bus, container);

    // reviewPullRequest called for each agent with an intent field.
    const calls = vi.mocked(reviewPullRequest).mock.calls;
    expect(calls).toHaveLength(2);
    for (const [input] of calls) {
      expect(input.intent).toBeDefined();
      expect(typeof input.intent).toBe('string');
      expect((input.intent as string).length).toBeGreaterThan(0);
    }
  });

  // (f) No intent section when classify fails.
  it('(f) agent prompt has NO intent section when classify fails (best-effort)', async () => {
    vi.mocked(classifyIntent).mockRejectedValue(new Error('Classify error'));

    const repo = makeRepo({ storedIntent: undefined });
    const bus = new RunBus();
    const container = makeContainer(bus);

    await runWithAgents([makeAgent('a1')], repo, bus, container);

    const calls = vi.mocked(reviewPullRequest).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]![0].intent).toBeUndefined();
  });

  // Extra: sectionTokens counts the intent section in the trace.
  it('sectionTokens includes intent key in trace tokens when assembly.intent is set', async () => {
    // Make reviewPullRequest return assembly.intent = some non-null string.
    const intentPayload = 'Intent: Add rate limiting\nIn scope:\n  - server/src/routes.ts';
    vi.mocked(reviewPullRequest).mockResolvedValue(
      makeFakeOutcome(intentPayload) as ReturnType<typeof reviewPullRequest> extends Promise<infer T> ? T : never,
    );

    const repo = makeRepo({ storedIntent: undefined });
    const bus = new RunBus();
    const container = makeContainer(bus);

    await runWithAgents([makeAgent('a1')], repo, bus, container);

    const savedTrace = vi.mocked(repo.saveRunTrace).mock.calls[0]?.[1];
    // intent section was in the assembly → sectionTokens should count it.
    expect(savedTrace?.prompt_assembly.tokens?.intent).toBeGreaterThan(0);
  });
});
