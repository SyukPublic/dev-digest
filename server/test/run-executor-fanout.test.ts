/**
 * Phase 3 (D1) — run-executor parallel fan-out + grounding-dropped trace.
 *
 * Asserts:
 * (a) FAN-OUT — N agents run in PARALLEL (a concurrency counter peaks > 1),
 *     not one-at-a-time. Total wall-clock ≈ MAX per-agent, not SUM.        → AC-13/14/16
 * (b) FAILURE ISOLATION — one agent throws, its own row is marked FAILED,
 *     the OTHER agents still complete as 'done'.                            → AC-15
 * (c) GROUNDING_DROPPED — `outcome.dropped` is mapped into the persisted
 *     trace's `grounding_dropped`; omitted when nothing was dropped; and
 *     the trace is written BEFORE the terminal 'done' status (load-bearing). → AC-31
 *
 * Unit test (no DB, no real LLM, no real diff loader — all fakes): the sibling
 * `run-executor-intent.test.ts` is the same fakes-based shape. The `.it.test`
 * suffix is reserved for DB-backed tests (server AGENTS.md), so a fully-mocked
 * deterministic test belongs in the unit suite.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import type { Container } from '../src/platform/container.js';
import type { PullRow, RepoRow, AgentRow } from '../src/db/rows.js';
import type { ReviewRepository } from '../src/modules/reviews/repository.js';
import type { Finding, Intent, UnifiedDiff } from '@devdigest/shared';
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

/** Minimal fake ReviewOutcome (from the reviewPullRequest mock). */
function makeFakeOutcome(dropped: { finding: Finding; reason: string }[] = []) {
  return {
    review: { findings: [], verdict: 'approved', summary: 'Looks good', score: 95 },
    grounding: dropped.length > 0 ? `0/${dropped.length} passed` : '0/0 passed',
    dropped,
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

describe('ReviewRunExecutor — parallel fan-out + grounding trace (Phase 3)', () => {
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
  });

  // (a) — the agents actually overlap in time (concurrency counter peaks > 1).
  it('(a) runs agents in PARALLEL — concurrency peaks above 1 (not sequential)', async () => {
    let active = 0;
    let peak = 0;
    vi.mocked(reviewPullRequest).mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      // Hold the "review" open long enough that siblings enter concurrently.
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return makeFakeOutcome() as FakeOutcome;
    });

    const repo = makeRepo();
    const bus = new RunBus();
    const container = makeContainer(bus);

    await runWithAgents([makeAgent('a1'), makeAgent('a2'), makeAgent('a3')], repo, bus, container);

    // Sequential would peak at exactly 1; parallel fan-out overlaps them.
    expect(peak).toBeGreaterThan(1);
    // All three ran.
    expect(vi.mocked(reviewPullRequest)).toHaveBeenCalledTimes(3);
  });

  // (b) — one agent throws; its row is FAILED, the others still complete 'done'.
  it('(b) failure isolation — a thrown agent fails only its own run; siblings finish done', async () => {
    vi.mocked(reviewPullRequest).mockImplementation(async (input) => {
      // sessionId = `${owner}/${name}#${number}:${agent.name}` → target 'Agent a2'.
      if (input.sessionId?.endsWith(':Agent a2')) throw new Error('boom');
      return makeFakeOutcome() as FakeOutcome;
    });

    const repo = makeRepo();
    const bus = new RunBus();
    const container = makeContainer(bus);

    // Should resolve (the queue drains every job; the failure is swallowed).
    await expect(
      runWithAgents([makeAgent('a1'), makeAgent('a2'), makeAgent('a3')], repo, bus, container),
    ).resolves.toBeTruthy();

    const statusByRun = new Map<string, string>();
    for (const [runId, patch] of vi.mocked(repo.completeAgentRun).mock.calls) {
      statusByRun.set(runId as string, (patch as { status: string }).status);
    }
    // a2 (run-1) failed; a1 (run-0) and a3 (run-2) still completed.
    expect(statusByRun.get('run-0')).toBe('done');
    expect(statusByRun.get('run-1')).toBe('failed');
    expect(statusByRun.get('run-2')).toBe('done');
    // Every run got exactly one terminal status write.
    expect(vi.mocked(repo.completeAgentRun)).toHaveBeenCalledTimes(3);
  });

  // (c) — outcome.dropped lands in the persisted trace's grounding_dropped.
  it('(c) maps outcome.dropped → trace.grounding_dropped (title/file/lines/reason)', async () => {
    const droppedFinding = {
      id: 'f-1',
      severity: 'high',
      category: 'bug',
      title: 'Possible null deref',
      file: 'server/src/x.ts',
      start_line: 12,
      end_line: 14,
      body: 'x may be null',
    } as unknown as Finding;
    vi.mocked(reviewPullRequest).mockImplementation(
      async () => makeFakeOutcome([{ finding: droppedFinding, reason: "file not present in diff" }]) as FakeOutcome,
    );

    const repo = makeRepo();
    const bus = new RunBus();
    const container = makeContainer(bus);

    await runWithAgents([makeAgent('a1')], repo, bus, container);

    const savedTrace = vi.mocked(repo.saveRunTrace).mock.calls[0]?.[1];
    expect(savedTrace?.grounding_dropped).toEqual([
      {
        title: 'Possible null deref',
        file: 'server/src/x.ts',
        start_line: 12,
        end_line: 14,
        reason: 'file not present in diff',
      },
    ]);

    // Load-bearing: the trace is persisted BEFORE the terminal 'done' status.
    const traceOrder = vi.mocked(repo.saveRunTrace).mock.invocationCallOrder[0]!;
    const statusOrder = vi.mocked(repo.completeAgentRun).mock.invocationCallOrder[0]!;
    expect(traceOrder).toBeLessThan(statusOrder);
  });

  // (c) — no dropped findings ⇒ grounding_dropped is OMITTED (old traces unaffected).
  it('(c) omits grounding_dropped when nothing was dropped', async () => {
    vi.mocked(reviewPullRequest).mockImplementation(async () => makeFakeOutcome([]) as FakeOutcome);

    const repo = makeRepo();
    const bus = new RunBus();
    const container = makeContainer(bus);

    await runWithAgents([makeAgent('a1')], repo, bus, container);

    const savedTrace = vi.mocked(repo.saveRunTrace).mock.calls[0]?.[1];
    expect(savedTrace?.grounding_dropped).toBeUndefined();
  });
});
