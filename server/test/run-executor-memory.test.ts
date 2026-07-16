/**
 * Phase 4 — run-executor review-memory injection wiring.
 *
 * Unit under test: `ReviewRunExecutor.executeRuns` / `runOneAgent` — the memory
 * injection site (shared pre-work retrieves ONCE; each agent gets the SAME
 * memory; the trace carries the shared `memory_pulled` snapshot).
 *
 * Stubs: `MemoryService.retrieveRelevant` (an external dependency the executor
 * constructs itself via `new MemoryService(container)` — mocked at the module
 * boundary exactly like `classifyIntent`/`loadDiff`/`reviewPullRequest` in the
 * sibling `run-executor-fanout.test.ts` / `run-executor-intent.test.ts`; the
 * unit under test, `ReviewRunExecutor`, is never stubbed).
 *
 * Asserts:
 * (a) AC-26/AC-9 — `retrieveRelevant` is called exactly ONCE across N agents,
 *     and every agent's `reviewPullRequest` input carries the SAME memory
 *     items (test_multi_agent_same_memory / test_inject_topn).
 * (b) AC-10 — every persisted run trace carries the shared `memory_pulled`
 *     snapshot (test_trace_and_lastused).
 * (c) AC-11/AC-12 — a degraded retrieval (embeddings off / no match) omits the
 *     `memory` key from `reviewPullRequest`'s input entirely (not `memory: []`)
 *     and persists `memory_pulled: []` (test_degrade_embeddings_off).
 * (d) The retrieval query text is derived from the PR title + body + the
 *     derived intent summary, once per review.
 *
 * No DB, no real LLM, no real diff loader — all fakes (server AGENTS.md: a
 * fully-mocked deterministic test belongs in the unit suite, not `.it.test`).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import type { Container } from '../src/platform/container.js';
import type { PullRow, RepoRow, AgentRow } from '../src/db/rows.js';
import type { ReviewRepository } from '../src/modules/reviews/repository.js';
import type { Intent, MemoryPulled, UnifiedDiff } from '@devdigest/shared';
import { RunBus } from '../src/platform/sse.js';

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

vi.mock('../src/modules/memory/service.js', () => ({
  MemoryService: vi.fn(),
}));

// ── import after vi.mock so the mocks are in effect ──────────────────────────

import { loadDiff } from '../src/modules/reviews/diff-loader.js';
import { classifyIntent } from '../src/modules/reviews/intent-service.js';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import { MemoryService } from '../src/modules/memory/service.js';

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
  body: 'Adds a token-bucket limiter to the public endpoints.',
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

/** Minimal fake ReviewOutcome (from the reviewPullRequest mock). */
function makeFakeOutcome() {
  return {
    review: { findings: [], verdict: 'approved', summary: 'Looks good', score: 95 },
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
      intent: null,
    },
    chunks: [{ label: 'all files' }],
    tokensIn: 100,
    tokensOut: 50,
    costUsd: 0.001,
    raw: '{}',
  };
}

type FakeOutcome = ReturnType<typeof reviewPullRequest> extends Promise<infer T> ? T : never;

/** Build a fake container (no real LLM; db stub → resolveFeatureModel falls back to default). */
function makeContainer(bus: RunBus): Container {
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
function makeRepo(): ReviewRepository {
  return {
    getIntent: vi.fn().mockResolvedValue(undefined),
    upsertIntent: vi.fn().mockResolvedValue(undefined),
    insertReview: vi.fn().mockResolvedValue({ id: 'review-1' }),
    insertFindings: vi.fn().mockResolvedValue([]),
    completeAgentRun: vi.fn().mockResolvedValue(undefined),
    saveRunTrace: vi.fn().mockResolvedValue(undefined),
    markReviewed: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReviewRepository;
}

function makeAgentsRepo() {
  return { linkedSkills: vi.fn().mockResolvedValue([]) } as unknown as Container['agentsRepo'];
}

/** Run executeRuns with the given agents; runIds are `run-<index>`. */
async function runWithAgents(agents: AgentRow[], repo: ReviewRepository, bus: RunBus, container: Container) {
  const executor = new ReviewRunExecutor(container, repo, makeAgentsRepo());
  const jobs = agents.map((agent, i) => ({ agent, runId: `run-${i}` }));
  for (const j of jobs) bus.publish(j.runId, 'info', 'init');
  await executor.executeRuns('ws-1', FAKE_PULL, FAKE_REPO, jobs);
  return jobs;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ReviewRunExecutor — review-memory injection (Phase 4)', () => {
  const retrieveRelevantMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadDiff).mockResolvedValue(FAKE_DIFF);
    vi.mocked(classifyIntent).mockResolvedValue({
      intent: FAKE_INTENT,
      tokensSaved: 200,
      tokensIn: 50,
      tokensOut: 20,
      costUsd: 0.0002,
    });
    vi.mocked(reviewPullRequest).mockImplementation(async () => makeFakeOutcome() as FakeOutcome);
    retrieveRelevantMock.mockReset();
    vi.mocked(MemoryService).mockImplementation(
      () => ({ retrieveRelevant: retrieveRelevantMock }) as unknown as MemoryService,
    );
  });

  it('test_multi_agent_same_memory / test_inject_topn: retrieveRelevant runs ONCE and every agent gets the SAME memory (AC-9/26)', async () => {
    const items = ['Stripe webhook raw-body parsing is intentional.', 'Migrations ship in their own PR.'];
    const pulled: MemoryPulled[] = [{ pr: 401, text: items[0]! }, { text: items[1]! }];
    retrieveRelevantMock.mockResolvedValue({ items, pulled });

    const repo = makeRepo();
    const bus = new RunBus();
    const container = makeContainer(bus);

    await runWithAgents([makeAgent('a1'), makeAgent('a2'), makeAgent('a3')], repo, bus, container);

    // Retrieval is shared pre-work — ONE call for the whole review, not per agent.
    expect(retrieveRelevantMock).toHaveBeenCalledTimes(1);

    // Every one of the 3 agents' assembled input carries the identical memory list.
    const calls = vi.mocked(reviewPullRequest).mock.calls;
    expect(calls).toHaveLength(3);
    for (const [input] of calls) {
      expect(input.memory).toEqual(items);
    }

    // Every persisted trace carries the SAME memory_pulled snapshot (AC-10/26).
    const traceCalls = vi.mocked(repo.saveRunTrace).mock.calls;
    expect(traceCalls).toHaveLength(3);
    for (const [, trace] of traceCalls) {
      expect(trace.memory_pulled).toEqual(pulled);
    }
  });

  it('test_inject_topn: the retrieval query text is derived from PR title + body + intent, once per review (AC-9)', async () => {
    retrieveRelevantMock.mockResolvedValue({ items: [], pulled: [] });

    const repo = makeRepo();
    const bus = new RunBus();
    const container = makeContainer(bus);

    await runWithAgents([makeAgent('a1')], repo, bus, container);

    expect(retrieveRelevantMock).toHaveBeenCalledTimes(1);
    const [workspaceId, repoId, queryText] = retrieveRelevantMock.mock.calls[0]!;
    expect(workspaceId).toBe('ws-1');
    expect(repoId).toBe(FAKE_PULL.repoId);
    expect(queryText).toContain(FAKE_PULL.title);
    expect(queryText).toContain(FAKE_PULL.body);
    expect(queryText).toContain(FAKE_INTENT.intent);
  });

  it('test_degrade_embeddings_off: an empty retrieval OMITS the memory key (not memory: []) and persists memory_pulled: [] (AC-11/12)', async () => {
    retrieveRelevantMock.mockResolvedValue({ items: [], pulled: [] });

    const repo = makeRepo();
    const bus = new RunBus();
    const container = makeContainer(bus);

    await runWithAgents([makeAgent('a1'), makeAgent('a2')], repo, bus, container);

    // Best-effort: review proceeds normally for both agents.
    const calls = vi.mocked(reviewPullRequest).mock.calls;
    expect(calls).toHaveLength(2);
    for (const [input] of calls) {
      // omit-when-empty contract — `memory` key must be ABSENT, not an empty array,
      // so the assembled prompt is byte-identical to the no-memory baseline (AC-12).
      expect('memory' in input).toBe(false);
    }

    for (const [, trace] of vi.mocked(repo.saveRunTrace).mock.calls) {
      expect(trace.memory_pulled).toEqual([]);
    }
  });
});
