import { describe, it, expect, vi } from 'vitest';
import type { Container } from '../src/platform/container.js';
import type { EvalRepository } from '../src/modules/eval/repository.js';
import type {
  SkillEvalRunExecutor,
  SkillSuiteSnapshot,
} from '../src/modules/eval/skill-run-executor.js';
import { SkillStabilityExecutor } from '../src/modules/eval/skill-stability-executor.js';

/**
 * Phase 4 (T13/T14) — the stability executor's repeat loop over the UNCHANGED
 * differential executor. `test_stability_executor` → AC-1/AC-2/AC-8.
 *
 * No DB, no real LLM: a fake repo records inserts + the terminal decision, and a
 * fake `SkillEvalRunExecutor.run` records the snapshot reference it received so
 * the SAME-object-every-iteration invariant (AC-2) can be asserted directly.
 */

function snapshot(overrides: Partial<SkillSuiteSnapshot> = {}): SkillSuiteSnapshot {
  return {
    workspaceId: 'ws-1',
    skillId: 'skill-1',
    skillVersion: 4,
    skillBody: 'body',
    skillSource: 'manual',
    hostAgentId: 'agent-1',
    hostAgentName: 'Host',
    hostAgentVersion: 7,
    provider: 'openai',
    model: 'gpt-4.1',
    systemPrompt: 'Review.',
    strategy: 'single-pass',
    hostSkills: [],
    caseIds: ['case-1'],
    ...overrides,
  };
}

interface FakeRepo {
  insertSkillSuite: ReturnType<typeof vi.fn>;
  listRunsByStabilityGroup: ReturnType<typeof vi.fn>;
  setStabilityGroupTerminal: ReturnType<typeof vi.fn>;
}

/** A repo whose child runs terminate with the given statuses (one per iteration). */
function fakeRepo(childStatuses: ('done' | 'failed')[]): FakeRepo {
  let n = 0;
  const inserted: string[] = [];
  return {
    insertSkillSuite: vi.fn(async () => {
      const id = `child-${n++}`;
      inserted.push(id);
      return { id };
    }),
    listRunsByStabilityGroup: vi.fn(async () =>
      inserted.map((id, i) => ({ id, status: childStatuses[i] ?? 'done' })),
    ),
    setStabilityGroupTerminal: vi.fn(async () => undefined),
  };
}

function fakeSkillExecutor(): { run: ReturnType<typeof vi.fn>; snapshots: SkillSuiteSnapshot[] } {
  const snapshots: SkillSuiteSnapshot[] = [];
  return {
    run: vi.fn(async (_suiteId: string, snap: SkillSuiteSnapshot) => {
      snapshots.push(snap);
    }),
    snapshots,
  };
}

describe('SkillStabilityExecutor.run — AC-1/AC-2 (repeat the SAME snapshot N times)', () => {
  it('inserts N child suites linked to the group and runs the executor N times', async () => {
    const repo = fakeRepo(['done', 'done', 'done']);
    const skillExec = fakeSkillExecutor();
    const exec = new SkillStabilityExecutor(
      {} as Container,
      repo as unknown as EvalRepository,
      skillExec as unknown as SkillEvalRunExecutor,
    );

    await exec.run('g1', snapshot(), 3);

    expect(repo.insertSkillSuite).toHaveBeenCalledTimes(3);
    // every child insert links the stability group + carries the snapshot versions
    for (const call of repo.insertSkillSuite.mock.calls) {
      expect(call[0]).toEqual(
        expect.objectContaining({
          stabilityGroupId: 'g1',
          skillId: 'skill-1',
          skillVersion: 4,
          hostAgentVersion: 7,
        }),
      );
    }
    expect(skillExec.run).toHaveBeenCalledTimes(3);
  });

  it('hands the IDENTICAL snapshot object into every one of the N runs (AC-2)', async () => {
    const repo = fakeRepo(['done', 'done']);
    const skillExec = fakeSkillExecutor();
    const exec = new SkillStabilityExecutor(
      {} as Container,
      repo as unknown as EvalRepository,
      skillExec as unknown as SkillEvalRunExecutor,
    );
    const snap = snapshot();

    await exec.run('g1', snap, 2);

    expect(skillExec.snapshots).toHaveLength(2);
    // Same reference, not merely a deep-equal copy — the freeze holds for free.
    expect(skillExec.snapshots[0]).toBe(snap);
    expect(skillExec.snapshots[1]).toBe(snap);
  });

  it('flips the group DONE when ≥2 children completed', async () => {
    const repo = fakeRepo(['done', 'done', 'failed']);
    const exec = new SkillStabilityExecutor(
      {} as Container,
      repo as unknown as EvalRepository,
      fakeSkillExecutor() as unknown as SkillEvalRunExecutor,
    );
    await exec.run('g1', snapshot(), 3);
    expect(repo.setStabilityGroupTerminal).toHaveBeenCalledWith('g1', 'done');
  });

  it('flips the group FAILED when fewer than 2 children completed (AC-8)', async () => {
    const repo = fakeRepo(['done', 'failed']);
    const exec = new SkillStabilityExecutor(
      {} as Container,
      repo as unknown as EvalRepository,
      fakeSkillExecutor() as unknown as SkillEvalRunExecutor,
    );
    await exec.run('g1', snapshot(), 2);
    expect(repo.setStabilityGroupTerminal).toHaveBeenCalledWith('g1', 'failed');
  });

  it('continues the loop even if a child run throws unexpectedly (never aborts)', async () => {
    const repo = fakeRepo(['done', 'done']);
    const skillExec = fakeSkillExecutor();
    skillExec.run.mockRejectedValueOnce(new Error('unexpected'));
    const exec = new SkillStabilityExecutor(
      {} as Container,
      repo as unknown as EvalRepository,
      skillExec as unknown as SkillEvalRunExecutor,
    );
    await exec.run('g1', snapshot(), 2);
    // Both iterations attempted despite the first throw.
    expect(repo.insertSkillSuite).toHaveBeenCalledTimes(2);
    expect(repo.setStabilityGroupTerminal).toHaveBeenCalledTimes(1);
  });
});
