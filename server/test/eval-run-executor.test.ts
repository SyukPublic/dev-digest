/**
 * Unit test for AC-13 / T21 (`test_suite_inputs`): the suite executor must feed
 * the review engine ONLY the case's diff + PR meta + the agent's snapshot
 * config — never repo-intel, PR intent, repo map, or callers context (D3).
 *
 * Mocking `reviewPullRequest` (the reviewer-core boundary — an external engine
 * from the eval module's point of view, mirroring how `run-executor-intent.test.ts`
 * mocks the same boundary; NOT the unit under test) lets us assert on the actual
 * call shape `EvalRunExecutor.executeCase` constructs — its real, observable output.
 * No DB, no real LLM.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EvalCaseRow } from '../src/db/rows.js';
import type { Container } from '../src/platform/container.js';
import type { EvalRepository } from '../src/modules/eval/repository.js';

// ── vi.mock must be hoisted ───────────────────────────────────────────────────

vi.mock('@devdigest/reviewer-core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@devdigest/reviewer-core')>();
  return { ...original, reviewPullRequest: vi.fn() };
});

// ── import after vi.mock so the mock is in effect ────────────────────────────

import { reviewPullRequest } from '@devdigest/reviewer-core';
import { EvalRunExecutor, type SuiteSnapshot } from '../src/modules/eval/run-executor.js';
import { scoreCase } from '../src/modules/eval/scoring.js';
import type { UnifiedDiff } from '@devdigest/shared';

const DIFF = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,3 @@\n a\n+b\n c\n';

function caseRow(overrides: Partial<EvalCaseRow> = {}): EvalCaseRow {
  return {
    id: 'case-1',
    workspaceId: 'ws-1',
    ownerKind: 'agent',
    ownerId: 'agent-1',
    name: 'a case',
    inputDiff: DIFF,
    inputFiles: null,
    inputMeta: null,
    expectedOutput: { expectation: 'must_find', findings: [{ file: 'a.ts', start_line: 2, end_line: 2 }] },
    notes: null,
    ...overrides,
  } as EvalCaseRow;
}

const BASE_SNAPSHOT: Pick<SuiteSnapshot, 'systemPrompt' | 'model' | 'provider' | 'strategy' | 'skills'> = {
  systemPrompt: 'Review this diff.',
  model: 'gpt-4.1',
  provider: 'openai',
  strategy: 'single-pass',
  skills: [],
};

const REVIEW_OUTCOME_FIXTURE = {
  review: { verdict: 'approve', summary: 's', score: 100, findings: [] },
  dropped: [],
  costUsd: 0,
} as unknown as ReturnType<typeof reviewPullRequest> extends Promise<infer T> ? T : never;

describe('EvalRunExecutor.executeCase — AC-13 (engine input is fixed to diff + PR meta + config)', () => {
  beforeEach(() => {
    vi.mocked(reviewPullRequest).mockReset();
    vi.mocked(reviewPullRequest).mockResolvedValue(REVIEW_OUTCOME_FIXTURE);
  });

  it('passes ONLY systemPrompt/model/diff/llm/strategy — no callers/repoMap/intent — when the case has no PR meta', async () => {
    const executor = new EvalRunExecutor({} as Container, {} as EvalRepository);
    const llm = { id: 'openai' } as unknown as Awaited<ReturnType<Container['llm']>>;

    await executor.executeCase(caseRow(), BASE_SNAPSHOT, llm);

    expect(vi.mocked(reviewPullRequest)).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(reviewPullRequest).mock.calls[0]![0] as unknown as Record<string, unknown>;
    // No repo-intel / PR-intent / repo-map / callers injection (D3 / AC-13).
    expect(callArgs).not.toHaveProperty('callers');
    expect(callArgs).not.toHaveProperty('repoMap');
    expect(callArgs).not.toHaveProperty('intent');
    expect(callArgs).not.toHaveProperty('memory');
    expect(callArgs).not.toHaveProperty('specs');
    // Exactly the allowed keys reach the engine — an exact-set check so a future
    // accidental addition of a forbidden field fails this test.
    expect(Object.keys(callArgs).sort()).toEqual(['diff', 'llm', 'model', 'strategy', 'systemPrompt']);
    expect(callArgs.systemPrompt).toBe('Review this diff.');
    expect(callArgs.diff).toEqual(expect.objectContaining({ files: expect.any(Array) }));
  });

  it('surfaces ONLY prDescription/task (from stored PR meta) and skills (from the snapshot) — still no callers/repoMap/intent', async () => {
    const executor = new EvalRunExecutor({} as Container, {} as EvalRepository);
    const llm = { id: 'openai' } as unknown as Awaited<ReturnType<Container['llm']>>;
    const row = caseRow({ inputMeta: { title: 'Add rate limiting', body: 'Closes #471.' } });
    const snapshotWithSkills: typeof BASE_SNAPSHOT = {
      ...BASE_SNAPSHOT,
      skills: [{ body: 'Prefer named exports.', trusted: true }],
    };

    await executor.executeCase(row, snapshotWithSkills, llm);

    const callArgs = vi.mocked(reviewPullRequest).mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty('callers');
    expect(callArgs).not.toHaveProperty('repoMap');
    expect(callArgs).not.toHaveProperty('intent');
    expect(Object.keys(callArgs).sort()).toEqual(
      ['diff', 'llm', 'model', 'prDescription', 'skills', 'strategy', 'systemPrompt', 'task'].sort(),
    );
    expect(callArgs.prDescription).toBe('Closes #471.');
    expect(callArgs.task).toBe('Review: Add rate limiting');
    expect(callArgs.skills).toEqual([{ body: 'Prefer named exports.', trusted: true }]);
  });
});

describe('EvalRunExecutor.executeCase — T11/T12 input_files synthesis (AC-6/AC-10/AC-11/AC-18/AC-22)', () => {
  beforeEach(() => {
    vi.mocked(reviewPullRequest).mockReset();
    vi.mocked(reviewPullRequest).mockResolvedValue(REVIEW_OUTCOME_FIXTURE);
  });

  it('T11 — files win over input_diff and feed the engine an ordinary UnifiedDiff; a `<path>:12` citation grounds', async () => {
    const executor = new EvalRunExecutor({} as Container, {} as EvalRepository);
    const llm = { id: 'openai' } as unknown as Awaited<ReturnType<Container['llm']>>;
    const content = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
    // input_diff is DIFFERENT (a.ts) — files must WIN (AC-6), so the engine sees src/config.ts.
    const row = caseRow({
      inputDiff: DIFF,
      inputFiles: [{ path: 'src/config.ts', content }],
    });

    await executor.executeCase(row, BASE_SNAPSHOT, llm);

    const callArgs = vi.mocked(reviewPullRequest).mock.calls[0]![0] as unknown as Record<string, unknown>;
    // Same UnifiedDiff shape reaches the engine (AC-18) — a plain diff, no files/marker leak.
    const diff = callArgs.diff as UnifiedDiff;
    expect(diff.files.map((f) => f.path)).toEqual(['src/config.ts']); // files won, not a.ts
    // Add-only synthesis numbers new-side lines 1..20; line 12 is covered → citation grounds (AC-11).
    const covered = diff.files[0]!.hunks.flatMap((h) => h.newLineNumbers);
    expect(covered).toContain(12);
    // The engine input carries no `input_files`/`files` key — only the diff (AC-13 exact set holds).
    expect(callArgs).not.toHaveProperty('input_files');
    expect(callArgs).not.toHaveProperty('files');
  });

  it('T12 — a file whose content holds a secret flows ONLY into the synthesized diff, never into the scorer', async () => {
    const executor = new EvalRunExecutor({} as Container, {} as EvalRepository);
    const llm = { id: 'openai' } as unknown as Awaited<ReturnType<Container['llm']>>;
    // Synthetic sentinel — deliberately NOT matching any real credential pattern
    // (e.g. Stripe `sk_live_…`) so it never trips secret scanners; the test only
    // needs a unique string to trace from the diff into (and out of) the scorer.
    const SECRET = 'FAKE-secret-sentinel-not-a-real-key-DoNotScan';
    const row = caseRow({
      inputFiles: [{ path: 'src/config.ts', content: `export const stripeKey = "${SECRET}";` }],
    });

    const exec = await executor.executeCase(row, BASE_SNAPSHOT, llm);

    // The secret is present in the raw diff fed to the engine…
    const diff = (vi.mocked(reviewPullRequest).mock.calls[0]![0] as unknown as { diff: UnifiedDiff }).diff;
    expect(diff.raw).toContain(SECRET);
    // …but the scorer input (expected + findings + dropped + cost) never carries it — scoring is
    // a pure function of these, with no LLM and no raw diff (AC-22).
    const scorerInput = JSON.stringify({
      expected: exec.expected,
      findings: exec.findings,
      dropped: exec.dropped,
      costUsd: exec.costUsd,
    });
    expect(scorerInput).not.toContain(SECRET);
    // The pure scorer runs off that input and produces a score without touching the secret.
    expect(() => scoreCase(exec)).not.toThrow();
  });
});
