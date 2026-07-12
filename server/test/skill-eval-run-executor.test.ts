/**
 * Unit tests for the DIFFERENTIAL skill-eval executor (Phase 3, T12/T13/T14).
 *
 * `test_arm_builder`   — buildArms: WITHOUT = host enabled-linked MINUS the eval
 *                        skill (by id); WITH = WITHOUT ∪ eval, deduped, injected
 *                        regardless of enabled; trust from source (AC-5/AC-7).
 * `test_skill_executor`— executeCase calls the engine TWICE (WITHOUT then WITH),
 *                        computes + classifies the delta, combines cost (AC-9/AC-13/
 *                        AC-16/AC-18); run persists a per-case delta row with
 *                        `skillSuiteRunId` BEFORE the terminal flip, continues past
 *                        an either-arm failure, and fails a zero-attempt suite
 *                        (AC-8/AC-11/AC-15/AC-21).
 *
 * Mocks the `reviewPullRequest` boundary (an external engine from the eval module's
 * POV — same seam the L06 `eval-run-executor.test.ts` mocks) + a fake repo + a fake
 * `Container.llm`. No DB, no real LLM.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Finding, EvalExpectedOutput } from '@devdigest/shared';
import type { EvalCaseRow } from '../src/db/rows.js';
import type { Container } from '../src/platform/container.js';
import type { EvalRepository } from '../src/modules/eval/repository.js';

vi.mock('@devdigest/reviewer-core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@devdigest/reviewer-core')>();
  return { ...original, reviewPullRequest: vi.fn() };
});

import { reviewPullRequest } from '@devdigest/reviewer-core';
import {
  SkillEvalRunExecutor,
  buildArms,
  type SkillSuiteSnapshot,
  type HostLinkedSkill,
} from '../src/modules/eval/skill-run-executor.js';

const DIFF = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,3 @@\n a\n+b\n c\n';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f-1',
    severity: 'medium',
    category: 'bug',
    title: 'a finding',
    file: 'a.ts',
    start_line: 1,
    end_line: 2,
    rationale: 'because',
    confidence: 0.9,
    ...overrides,
  } as Finding;
}

function outcome(findings: Finding[], dropped: Finding[], costUsd: number | null) {
  return {
    review: { verdict: 'comment', summary: 's', score: 80, findings },
    grounding: '',
    dropped: dropped.map((f) => ({ finding: f, reason: 'no citation' })),
    mode: 'single-pass',
    assembly: {},
    chunks: [],
    tokensIn: 0,
    tokensOut: 0,
    costUsd,
    raw: '',
  } as unknown as Awaited<ReturnType<typeof reviewPullRequest>>;
}

function caseRow(overrides: Partial<EvalCaseRow> = {}): EvalCaseRow {
  return {
    id: 'case-1',
    workspaceId: 'ws-1',
    ownerKind: 'skill',
    ownerId: 'skill-1',
    name: 'a case',
    inputDiff: DIFF,
    inputFiles: null,
    inputMeta: null,
    expectedOutput: {
      expectation: 'must_find',
      findings: [{ file: 'b.ts', start_line: 1, end_line: 2 }],
    } satisfies EvalExpectedOutput,
    notes: null,
    ...overrides,
  } as EvalCaseRow;
}

function snapshot(overrides: Partial<SkillSuiteSnapshot> = {}): SkillSuiteSnapshot {
  return {
    workspaceId: 'ws-1',
    skillId: 'skill-1',
    skillVersion: 1,
    skillBody: 'Prefer named exports.',
    skillSource: 'manual',
    hostAgentId: 'agent-1',
    hostAgentName: 'Host',
    hostAgentVersion: 3,
    provider: 'openai',
    model: 'gpt-4.1',
    systemPrompt: 'Review this diff.',
    strategy: 'single-pass',
    hostSkills: [],
    caseIds: ['case-1'],
    ...overrides,
  };
}

// ── T13 / test_arm_builder ────────────────────────────────────────────────────

describe('buildArms — AC-5/AC-7 (WITHOUT = host MINUS eval; WITH = WITHOUT ∪ eval)', () => {
  const host: HostLinkedSkill[] = [
    { skillId: 'skill-1', body: 'eval body', trusted: true },
    { skillId: 'skill-2', body: 'other body', trusted: false },
  ];

  it('removes the eval skill from WITHOUT (by id) and re-adds it to WITH', () => {
    const arms = buildArms(host, { id: 'skill-1', body: 'eval body v2', source: 'manual' });
    expect(arms.without).toEqual([{ body: 'other body', trusted: false }]);
    // WITH = WITHOUT + the eval skill's CURRENT body (snapshot), trusted by source.
    expect(arms.with).toEqual([
      { body: 'other body', trusted: false },
      { body: 'eval body v2', trusted: true },
    ]);
  });

  it('injects the eval skill even when the host does NOT link it (AC-7, regardless of enabled)', () => {
    const arms = buildArms([{ skillId: 'skill-2', body: 'other body', trusted: false }], {
      id: 'skill-1',
      body: 'eval body',
      source: 'extracted',
    });
    expect(arms.without).toEqual([{ body: 'other body', trusted: false }]);
    expect(arms.with).toContainEqual({ body: 'eval body', trusted: true });
    expect(arms.with).toHaveLength(2);
  });

  it('marks the eval skill untrusted when its source is imported_url / community', () => {
    expect(buildArms([], { id: 's', body: 'b', source: 'imported_url' }).with).toEqual([
      { body: 'b', trusted: false },
    ]);
    expect(buildArms([], { id: 's', body: 'b', source: 'community' }).with).toEqual([
      { body: 'b', trusted: false },
    ]);
  });

  it('dedups by body: the eval skill is appended only once', () => {
    const arms = buildArms([{ skillId: 'skill-2', body: 'dup', trusted: true }], {
      id: 'skill-1',
      body: 'dup',
      source: 'manual',
    });
    // WITHOUT has the dup body; WITH must not double it.
    expect(arms.with).toEqual([{ body: 'dup', trusted: true }]);
  });
});

// ── T12 / test_skill_executor (executeCase) ──────────────────────────────────

describe('SkillEvalRunExecutor.executeCase — AC-9/AC-13/AC-16/AC-18 (two arms → delta)', () => {
  beforeEach(() => vi.mocked(reviewPullRequest).mockReset());

  it('calls the engine TWICE (WITHOUT then WITH) and returns the CAUSED delta with combined cost', async () => {
    const baseline = finding({ id: 'baseline', file: 'a.ts', start_line: 10, end_line: 12 });
    const caused = finding({ id: 'caused', file: 'b.ts', start_line: 1, end_line: 2 });
    vi.mocked(reviewPullRequest)
      .mockResolvedValueOnce(outcome([baseline], [], 0.01)) // WITHOUT arm
      .mockResolvedValueOnce(outcome([baseline, caused], [], 0.02)); // WITH arm

    const executor = new SkillEvalRunExecutor({} as Container, {} as EvalRepository);
    const llm = {} as Awaited<ReturnType<Container['llm']>>;
    const exec = await executor.executeCase(caseRow(), snapshot({ hostSkills: [] }), llm);

    expect(vi.mocked(reviewPullRequest)).toHaveBeenCalledTimes(2);
    // First call = WITHOUT arm (no skills → key absent); second = WITH arm (eval skill).
    const first = vi.mocked(reviewPullRequest).mock.calls[0]![0] as Record<string, unknown>;
    const second = vi.mocked(reviewPullRequest).mock.calls[1]![0] as Record<string, unknown>;
    expect(first).not.toHaveProperty('skills');
    expect(second.skills).toEqual([{ body: 'Prefer named exports.', trusted: true }]);
    // Only the allowed engine keys reach it (no callers/repoMap/intent — AC-13).
    expect(Object.keys(first).sort()).toEqual(['diff', 'llm', 'model', 'strategy', 'systemPrompt']);

    // Delta = the CAUSED finding; cost = both arms combined (AC-18).
    expect(exec.findings.map((f) => f.id)).toEqual(['caused']);
    expect(exec.dropped).toBe(0);
    expect(exec.costUsd).toBeCloseTo(0.03);
    // Classified delta view stored as actual_output: caught (matches must_find b.ts).
    expect(exec.delta.findings).toEqual([
      expect.objectContaining({ file: 'b.ts', start_line: 1, end_line: 2, classification: 'caught' }),
    ]);
  });

  it('cost is null when EITHER arm cost is unknown (never treated as 0 — AC-18)', async () => {
    vi.mocked(reviewPullRequest)
      .mockResolvedValueOnce(outcome([], [], null))
      .mockResolvedValueOnce(outcome([finding({ file: 'b.ts', start_line: 1, end_line: 2 })], [], 0.02));
    const executor = new SkillEvalRunExecutor({} as Container, {} as EvalRepository);
    const exec = await executor.executeCase(caseRow(), snapshot(), {} as Awaited<ReturnType<Container['llm']>>);
    expect(exec.costUsd).toBeNull();
  });

  it('throws on a zero-file diff (feeds the engine nothing invalid)', async () => {
    const executor = new SkillEvalRunExecutor({} as Container, {} as EvalRepository);
    await expect(
      executor.executeCase(caseRow({ inputDiff: '' }), snapshot(), {} as Awaited<ReturnType<Container['llm']>>),
    ).rejects.toThrow(/zero files/);
    expect(vi.mocked(reviewPullRequest)).not.toHaveBeenCalled();
  });
});

// ── T14 / test_skill_executor (run) ───────────────────────────────────────────

interface FakeRepo {
  getCase: ReturnType<typeof vi.fn>;
  insertRun: ReturnType<typeof vi.fn>;
  setSkillSuiteTerminal: ReturnType<typeof vi.fn>;
}

function fakeRepo(cases: Record<string, EvalCaseRow | undefined>): FakeRepo {
  return {
    getCase: vi.fn(async (_ws: string, id: string) => cases[id]),
    insertRun: vi.fn(async () => ({})),
    setSkillSuiteTerminal: vi.fn(async () => undefined),
  };
}

function fakeContainer(llm: unknown = {}): Container {
  return { llm: vi.fn(async () => llm) } as unknown as Container;
}

describe('SkillEvalRunExecutor.run — AC-8/AC-11/AC-21 (lifecycle)', () => {
  beforeEach(() => vi.mocked(reviewPullRequest).mockReset());

  it('persists a per-case delta row with skillSuiteRunId BEFORE the done terminal', async () => {
    vi.mocked(reviewPullRequest)
      .mockResolvedValueOnce(outcome([], [], 0.01)) // WITHOUT arm: no finding
      .mockResolvedValueOnce(outcome([finding({ file: 'b.ts', start_line: 1, end_line: 2 })], [], 0.01)); // WITH arm: caused
    const repo = fakeRepo({ 'case-1': caseRow() });
    const executor = new SkillEvalRunExecutor(fakeContainer(), repo as unknown as EvalRepository);

    await executor.run('suite-1', snapshot({ caseIds: ['case-1'] }));

    expect(repo.insertRun).toHaveBeenCalledTimes(1);
    const runArg = repo.insertRun.mock.calls[0]![0];
    expect(runArg.skillSuiteRunId).toBe('suite-1');
    expect(runArg.suiteRunId).toBeUndefined();
    expect(runArg.actualOutput).toEqual({
      findings: [expect.objectContaining({ classification: 'caught' })],
    });
    // Row persisted before terminal (AC-11).
    expect(repo.insertRun.mock.invocationCallOrder[0]).toBeLessThan(
      repo.setSkillSuiteTerminal.mock.invocationCallOrder[0]!,
    );
    const term = repo.setSkillSuiteTerminal.mock.calls[0]![1];
    expect(term.status).toBe('done');
    expect(term.total).toBe(1);
    expect(term.passed).toBe(1);
  });

  it('continues past an either-arm failure: writes an error+pass=false row, still finishes done', async () => {
    // case-1 fails (WITHOUT arm rejects), case-2 succeeds.
    vi.mocked(reviewPullRequest)
      .mockRejectedValueOnce(new Error('provider exploded'))
      .mockResolvedValueOnce(outcome([finding({ file: 'b.ts', start_line: 1, end_line: 2 })], [], 0.01))
      .mockResolvedValueOnce(outcome([finding({ file: 'b.ts', start_line: 1, end_line: 2 })], [], 0.01));
    const repo = fakeRepo({ 'case-1': caseRow({ id: 'case-1' }), 'case-2': caseRow({ id: 'case-2' }) });
    const executor = new SkillEvalRunExecutor(fakeContainer(), repo as unknown as EvalRepository);

    await executor.run('suite-1', snapshot({ caseIds: ['case-1', 'case-2'] }));

    expect(repo.insertRun).toHaveBeenCalledTimes(2);
    const failRow = repo.insertRun.mock.calls[0]![0];
    expect(failRow.error).toMatch(/provider exploded/);
    expect(failRow.pass).toBe(false);
    const term = repo.setSkillSuiteTerminal.mock.calls[0]![1];
    expect(term.status).toBe('done');
    expect(term.total).toBe(2); // both attempted
  });

  it('a case deleted mid-run drops out; zero attempted → suite failed (AC-21)', async () => {
    const repo = fakeRepo({ 'case-1': undefined });
    const executor = new SkillEvalRunExecutor(fakeContainer(), repo as unknown as EvalRepository);

    await executor.run('suite-1', snapshot({ caseIds: ['case-1'] }));

    expect(repo.insertRun).not.toHaveBeenCalled();
    expect(repo.setSkillSuiteTerminal.mock.calls[0]![1].status).toBe('failed');
  });

  it('a missing LLM key is a SETUP failure → suite failed, no rows persisted', async () => {
    const repo = fakeRepo({ 'case-1': caseRow() });
    const container = { llm: vi.fn(async () => { throw new Error('no key'); }) } as unknown as Container;
    const executor = new SkillEvalRunExecutor(container, repo as unknown as EvalRepository);

    await executor.run('suite-1', snapshot({ caseIds: ['case-1'] }));

    expect(repo.insertRun).not.toHaveBeenCalled();
    expect(repo.setSkillSuiteTerminal.mock.calls[0]![1].status).toBe('failed');
  });
});
