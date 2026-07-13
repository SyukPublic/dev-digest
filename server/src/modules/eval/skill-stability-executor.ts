import type { Container } from '../../platform/container.js';
import type { EvalRepository } from './repository.js';
import type { SkillEvalRunExecutor, SkillSuiteSnapshot } from './skill-run-executor.js';
import type { Logger } from '../reviews/run-executor.js';

/**
 * Skill Eval STABILITY LAYER — the repeat loop over the UNCHANGED differential
 * executor (SPEC-2026-07-12-skill-eval-stability-layer).
 *
 * A *stability group* repeats ONE frozen `SkillSuiteSnapshot` N times to sample
 * the LLM variance the differential model hides. This executor MUST NOT modify
 * `SkillEvalRunExecutor` — it CONSTRUCTS/RECEIVES it and reuses `.run` per
 * iteration, handing the SAME snapshot object into every one of the N calls, so
 * the differential AC-12 freeze guarantees no mid-group leak, for free (AC-2).
 *
 * Fire-and-forget (not awaited by the route): the N child suite runs execute
 * SEQUENTIALLY (bounding provider concurrency); the group flips terminal only
 * after the loop. A single child-run failure is already handled by the child
 * executor (it sets its OWN suite `failed`) — the group loop CONTINUES, never
 * aborting. IF fewer than 2 children complete, the group is `failed` and no
 * variance is reported (AC-8).
 */
export class SkillStabilityExecutor {
  constructor(
    private container: Container,
    private repo: EvalRepository,
    private skillExecutor: SkillEvalRunExecutor,
  ) {}

  /**
   * Repeat the frozen `snapshot` `n` times as child suite runs of `groupId`,
   * SEQUENTIALLY. Each iteration inserts a `running` child suite linked to the
   * group (its skill/host versions taken from the SAME snapshot) then AWAITS the
   * UNCHANGED `skillExecutor.run` on the IDENTICAL snapshot object. After the
   * loop, the group flips terminal by the `done`-child count (AC-8).
   */
  async run(
    groupId: string,
    snapshot: SkillSuiteSnapshot,
    n: number,
    logger?: Logger,
  ): Promise<void> {
    for (let i = 0; i < n; i += 1) {
      try {
        const child = await this.repo.insertSkillSuite({
          workspaceId: snapshot.workspaceId,
          skillId: snapshot.skillId,
          skillVersion: snapshot.skillVersion,
          hostAgentId: snapshot.hostAgentId,
          hostAgentVersion: snapshot.hostAgentVersion,
          stabilityGroupId: groupId,
        });
        // Reuse the SAME snapshot object every iteration → no mid-group leak (AC-2).
        // The child executor swallows its own failures (sets its suite failed),
        // so this await resolves even when a run fails — the group never aborts.
        await this.skillExecutor.run(child.id, snapshot, logger);
      } catch (err) {
        // An unexpected throw (e.g. the child insert) must not abort the group.
        logger?.warn(
          { groupId, iteration: i, err: (err as Error).message },
          'skill-stability: child run failed; continuing group',
        );
      }
    }

    // Terminal decision: at least 2 completed children are needed for a usable
    // stddev; otherwise the group is `failed` and no variance is reported (AC-8).
    const children = await this.repo.listRunsByStabilityGroup(groupId);
    const completed = children.filter((c) => c.status === 'done');
    await this.repo.setStabilityGroupTerminal(groupId, completed.length < 2 ? 'failed' : 'done');
  }
}
