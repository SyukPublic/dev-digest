import type { Container } from '../../platform/container.js';
import type { Provider, ReviewStrategy } from '@devdigest/shared';
import { reviewPullRequest, type SkillInput } from '@devdigest/reviewer-core';
import { parseUnifiedDiff } from '../../lib/diff-parser.js';
import type { EvalRepository } from './repository.js';
import type { EvalCaseRow } from '../../db/rows.js';
import { parseExpectedOutput } from './helpers.js';
import { scoreCase, poolSuite, type CaseRunResult } from './scoring.js';
import type { Logger } from '../reviews/run-executor.js';

/**
 * Immutable snapshot captured ONCE at suite start (AC-14/AC-26): the agent's
 * resolved config + version + RESOLVED linked-skill BODIES (not ids — a mid-run
 * skill-body edit must not leak into a running suite) + the START set of case
 * ids. The executor operates only on this snapshot, so edits made while the
 * suite runs do not affect it.
 */
export interface SuiteSnapshot {
  workspaceId: string;
  agentId: string;
  agentName: string;
  agentVersion: number;
  provider: Provider;
  model: string;
  systemPrompt: string;
  strategy: ReviewStrategy;
  /** Resolved skill bodies (enabled only), trust-flagged. */
  skills: SkillInput[];
  /** Case ids captured at suite start; a case deleted mid-run drops out (AC-26). */
  caseIds: string[];
}

/** Stored PR meta shape (input_meta) — all optional, treated as untrusted data. */
interface CaseMeta {
  title?: string;
  body?: string;
  number?: number;
  base?: string;
}

/** Per-case outcome fed to the pure scorer + persisted on the eval_runs row. */
export interface CaseExecution extends CaseRunResult {
  /** The grounded review stored as `actual_output`. */
  review: unknown;
  durationMs: number;
}

/**
 * L06 suite executor — the async, sequential, progressive runner mirroring the
 * review fire-and-forget pattern. Feeds the engine ONLY the stored diff + PR
 * meta + snapshot config (AC-13); persists EVERY per-case row BEFORE the suite
 * flips terminal (AC-11); a per-case LLM failure writes error+pass=false and the
 * suite CONTINUES (AC-21); a setup failure sets the suite `failed` (AC-22).
 */
export class EvalRunExecutor {
  constructor(
    private container: Container,
    private repo: EvalRepository,
  ) {}

  /** Run a single case through the engine + pure scorer (no persistence). */
  async executeCase(
    caseRow: EvalCaseRow,
    snapshot: Pick<
      SuiteSnapshot,
      'systemPrompt' | 'model' | 'provider' | 'strategy' | 'skills'
    >,
    llm: Awaited<ReturnType<Container['llm']>>,
  ): Promise<CaseExecution> {
    const start = Date.now();
    const envelope = parseExpectedOutput(caseRow.expectedOutput);
    if (!envelope) throw new Error('Case has an invalid expected_output envelope');

    const diff = parseUnifiedDiff(caseRow.inputDiff ?? '');
    if (diff.files.length === 0) throw new Error('Case diff parses to zero files');

    const meta = (caseRow.inputMeta ?? {}) as CaseMeta;

    // Engine input is FIXED to diff + PR meta + config (AC-13/AC-26): NO
    // callers / repoMap / intent / repo-intel injection, for comparability.
    const outcome = await reviewPullRequest({
      systemPrompt: snapshot.systemPrompt,
      model: snapshot.model,
      diff,
      llm,
      strategy: snapshot.strategy,
      ...(snapshot.skills.length > 0 ? { skills: snapshot.skills } : {}),
      ...(meta.body ? { prDescription: meta.body } : {}),
      ...(meta.title ? { task: `Review: ${meta.title}` } : {}),
    });

    return {
      expected: envelope,
      findings: outcome.review.findings,
      dropped: outcome.dropped.length,
      costUsd: outcome.costUsd,
      review: outcome.review,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Background execution of a suite (NOT awaited by the route). Sequential over
   * the START-snapshot case ids; deleted cases drop out; every per-case row is
   * persisted before the terminal status.
   */
  async run(suiteId: string, snapshot: SuiteSnapshot, logger?: Logger): Promise<void> {
    const suiteStart = Date.now();
    try {
      // Resolving the provider throws when the key is missing → a SETUP failure
      // (AC-22), handled by the outer catch.
      const llm = await this.container.llm(snapshot.provider);

      const successes: CaseRunResult[] = [];
      let attempted = 0;

      for (const caseId of snapshot.caseIds) {
        // Re-read from the start snapshot's workspace: a case deleted mid-run is
        // gone here and simply drops out without aborting the suite (AC-26).
        const caseRow = await this.repo.getCase(snapshot.workspaceId, caseId);
        if (!caseRow) continue;
        attempted += 1;

        try {
          const exec = await this.executeCase(caseRow, snapshot, llm);
          const score = scoreCase(exec);
          // Persist the per-case row BEFORE the suite terminal status (AC-11).
          await this.repo.insertRun({
            caseId,
            suiteRunId: suiteId,
            actualOutput: exec.review,
            pass: score.pass,
            recall: score.recall,
            precision: score.precision,
            citationAccuracy: score.citation_accuracy,
            durationMs: exec.durationMs,
            costUsd: score.cost_usd,
          });
          successes.push({
            expected: exec.expected,
            findings: exec.findings,
            dropped: exec.dropped,
            costUsd: exec.costUsd,
          });
        } catch (err) {
          // Per-case LLM failure (provider error / schema-repair exhausted): the
          // row carries the error + pass=false and the suite CONTINUES (AC-21).
          logger?.warn(
            { suiteId, caseId, err: (err as Error).message },
            'eval: case failed; continuing suite',
          );
          await this.repo.insertRun({
            caseId,
            suiteRunId: suiteId,
            actualOutput: null,
            pass: false,
            recall: null,
            precision: null,
            citationAccuracy: null,
            durationMs: 0,
            costUsd: null,
            error: (err as Error).message,
          });
        }
      }

      // All cases raced away before the loop could read any → SETUP failure (AC-22).
      if (attempted === 0) {
        await this.repo.setSuiteTerminal(suiteId, {
          status: 'failed',
          recall: null,
          precision: null,
          citationAccuracy: null,
          passed: 0,
          total: 0,
          costUsd: null,
          durationMs: Date.now() - suiteStart,
        });
        return;
      }

      // Pool micro-averaged metrics over the SUCCESSFUL cases; total counts every
      // attempted case (failed ones are non-passes), so passed/total is honest.
      const pooled = poolSuite(successes);
      await this.repo.setSuiteTerminal(suiteId, {
        status: 'done',
        recall: pooled.recall,
        precision: pooled.precision,
        citationAccuracy: pooled.citation_accuracy,
        passed: pooled.passed,
        total: attempted,
        costUsd: pooled.cost_usd,
        durationMs: Date.now() - suiteStart,
      });
    } catch (err) {
      // Setup failure (e.g. missing LLM key) → the suite transitions to failed.
      logger?.error({ suiteId, err: (err as Error).message }, 'eval: suite setup failed');
      await this.repo
        .setSuiteTerminal(suiteId, {
          status: 'failed',
          recall: null,
          precision: null,
          citationAccuracy: null,
          passed: 0,
          total: 0,
          costUsd: null,
          durationMs: Date.now() - suiteStart,
        })
        .catch(() => undefined);
    }
  }
}
