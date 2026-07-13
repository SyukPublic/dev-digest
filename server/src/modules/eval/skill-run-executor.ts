import type { Container } from '../../platform/container.js';
import type { Provider, ReviewStrategy, EvalSkillCaseDelta } from '@devdigest/shared';
import { reviewPullRequest, type SkillInput } from '@devdigest/reviewer-core';
import { parseUnifiedDiff } from '../../lib/diff-parser.js';
import type { EvalRepository } from './repository.js';
import type { EvalCaseRow, SkillRow } from '../../db/rows.js';
import { parseExpectedOutput, effectiveDiff } from './helpers.js';
import { scoreCase, poolSuite, type CaseRunResult } from './scoring.js';
import { computeDelta, classifyDelta, combineCost } from './delta.js';
import type { Logger } from '../reviews/run-executor.js';

/**
 * Skill Eval Pipeline — the DIFFERENTIAL (two-arm) suite executor
 * (SPEC-2026-07-12-skill-eval-differential).
 *
 * A skill delta is computed by running the SAME host review twice over a case's
 * stored diff + PR meta — WITHOUT the skill (baseline arm) and WITH it — the ONLY
 * difference between the arms being the injected `skills`. The findings the skill
 * CAUSED (`computeDelta`) become a synthetic `CaseRunResult` fed to the UNCHANGED
 * L06 scorer (`scoring.ts`); NO new scoring math and NO `reviewer-core` change.
 *
 * Mirrors `EvalRunExecutor` (agent path): feeds the engine ONLY the stored diff +
 * PR meta + snapshot config (AC-9/AC-13); persists EVERY per-case delta row BEFORE
 * the suite flips terminal (AC-11); an either-arm failure writes error+pass=false
 * and the suite CONTINUES (AC-21); a setup failure sets the suite `failed`.
 */

/** A host's enabled linked skill, trust-flagged and carrying its skill id. */
export interface HostLinkedSkill {
  skillId: string;
  body: string;
  trusted: boolean;
}

/**
 * Immutable snapshot captured ONCE at skill-suite start (AC-12): the skill under
 * eval (id, body, source, version), the resolved HOST agent (config + version +
 * its enabled-linked skill BODIES), and the START set of case ids. A mid-run skill
 * or host edit must not leak into a running suite, so bodies are captured here —
 * not re-read per case. Built and passed by the service (Phase 4).
 */
export interface SkillSuiteSnapshot {
  workspaceId: string;
  /** The skill under eval. */
  skillId: string;
  skillVersion: number;
  skillBody: string;
  skillSource: SkillRow['source'];
  /** The resolved host agent the two arms run on. */
  hostAgentId: string;
  hostAgentName: string;
  hostAgentVersion: number;
  provider: Provider;
  model: string;
  systemPrompt: string;
  strategy: ReviewStrategy;
  /** The host's enabled linked skills (trust-flagged, id-tagged) — the baseline arm base. */
  hostSkills: HostLinkedSkill[];
  /** Case ids captured at suite start; a case deleted mid-run drops out. */
  caseIds: string[];
}

/** Stored PR meta shape (input_meta) — all optional, treated as untrusted data. */
interface CaseMeta {
  title?: string;
  body?: string;
  number?: number;
  base?: string;
}

/** Per-case outcome: the scorer input + the classified delta persisted as `actual_output`. */
export interface SkillCaseExecution extends CaseRunResult {
  /** The classified delta view stored as `actual_output` (EvalSkillCaseDelta). */
  delta: EvalSkillCaseDelta;
  durationMs: number;
}

/**
 * T13 / AC-5, AC-7 — build the two skills arms (PURE):
 *  - WITHOUT = the host's enabled linked skills MINUS the eval skill (by skill id);
 *  - WITH    = WITHOUT ∪ the eval skill, appended ONCE (deduped by body), injected
 *              REGARDLESS of the eval skill's own `enabled` (AC-7).
 *
 * The eval skill's trust follows its source (`manual`/`extracted` are trusted).
 * `SkillInput` is `{ body, trusted }`; the arms differ ONLY by this set.
 */
export function buildArms(
  hostSkills: HostLinkedSkill[],
  evalSkill: { id: string; body: string; source: SkillRow['source'] },
): { without: SkillInput[]; with: SkillInput[] } {
  const evalTrusted = evalSkill.source === 'manual' || evalSkill.source === 'extracted';
  const withoutSkills = hostSkills.filter((s) => s.skillId !== evalSkill.id);
  const without: SkillInput[] = withoutSkills.map((s) => ({ body: s.body, trusted: s.trusted }));

  const withList: SkillInput[] = [...without];
  // Append the eval skill once, deduped by body (a distinct host skill sharing the
  // identical body must not be double-injected).
  if (!withList.some((s) => typeof s === 'object' && s.body === evalSkill.body)) {
    withList.push({ body: evalSkill.body, trusted: evalTrusted });
  }
  return { without, with: withList };
}

export class SkillEvalRunExecutor {
  constructor(
    private container: Container,
    private repo: EvalRepository,
  ) {}

  /**
   * T12 / AC-9, AC-13, AC-16, AC-18 — run ONE case through both arms, compute the
   * delta, classify it, and assemble the synthetic `CaseRunResult` (no persistence).
   * Engine input is FIXED to diff + PR meta + snapshot config for BOTH arms; the
   * ONLY difference between the arms is the injected `skills`.
   */
  async executeCase(
    caseRow: EvalCaseRow,
    snapshot: SkillSuiteSnapshot,
    llm: Awaited<ReturnType<Container['llm']>>,
  ): Promise<SkillCaseExecution> {
    const start = Date.now();
    const envelope = parseExpectedOutput(caseRow.expectedOutput);
    if (!envelope) throw new Error('Case has an invalid expected_output envelope');

    // Files (AC-6) win over the pasted diff (AC-8); same UnifiedDiff shape (AC-18/AC-21).
    const diff = effectiveDiff(caseRow);
    if (diff.files.length === 0) throw new Error('Case diff parses to zero files');

    const meta = (caseRow.inputMeta ?? {}) as CaseMeta;
    const arms = buildArms(snapshot.hostSkills, {
      id: snapshot.skillId,
      body: snapshot.skillBody,
      source: snapshot.skillSource,
    });

    // Baseline arm first, then the WITH-skill arm; both feed the engine ONLY diff +
    // PR meta + config (AC-9/AC-13) — no callers/repoMap/intent.
    const withoutOutcome = await this.runArm(diff, meta, snapshot, llm, arms.without);
    const withOutcome = await this.runArm(diff, meta, snapshot, llm, arms.with);

    const delta = computeDelta(
      { findings: withOutcome.review.findings, dropped: withOutcome.dropped.map((d) => d.finding) },
      {
        findings: withoutOutcome.review.findings,
        dropped: withoutOutcome.dropped.map((d) => d.finding),
      },
    );

    const classified: EvalSkillCaseDelta = {
      findings: delta.findings.map((f) => ({
        file: f.file,
        start_line: f.start_line,
        end_line: f.end_line,
        severity: f.severity,
        category: f.category,
        title: f.title,
        classification: classifyDelta(f, envelope),
      })),
    };

    return {
      expected: envelope,
      findings: delta.findings,
      dropped: delta.dropped,
      // Both arms are priced together; unknown from either → null (never 0) (AC-18).
      costUsd: combineCost(withOutcome.costUsd, withoutOutcome.costUsd),
      delta: classified,
      durationMs: Date.now() - start,
    };
  }

  /** One engine pass with a given skills set; engine input FIXED to diff + PR meta + config. */
  private runArm(
    diff: ReturnType<typeof parseUnifiedDiff>,
    meta: CaseMeta,
    snapshot: SkillSuiteSnapshot,
    llm: Awaited<ReturnType<Container['llm']>>,
    skills: SkillInput[],
  ): ReturnType<typeof reviewPullRequest> {
    return reviewPullRequest({
      systemPrompt: snapshot.systemPrompt,
      model: snapshot.model,
      diff,
      llm,
      strategy: snapshot.strategy,
      ...(skills.length > 0 ? { skills } : {}),
      ...(meta.body ? { prDescription: meta.body } : {}),
      ...(meta.title ? { task: `Review: ${meta.title}` } : {}),
    });
  }

  /**
   * T14 / AC-8, AC-11, AC-15, AC-21 — background execution of a differential suite
   * (NOT awaited by the route). Sequential over the START-snapshot case ids; a
   * deleted case drops out; every per-case delta row (carrying `skillSuiteRunId`,
   * `actual_output` = the classified delta) is persisted BEFORE the terminal flip;
   * an either-arm failure writes error+pass=false and the suite CONTINUES;
   * `attempted === 0` → suite `failed`; else pool + terminal.
   */
  async run(suiteId: string, snapshot: SkillSuiteSnapshot, logger?: Logger): Promise<void> {
    const suiteStart = Date.now();
    try {
      // Resolving the provider throws when the key is missing → a SETUP failure,
      // handled by the outer catch.
      const llm = await this.container.llm(snapshot.provider);

      const successes: CaseRunResult[] = [];
      let attempted = 0;

      for (const caseId of snapshot.caseIds) {
        // Re-read: a case deleted mid-run is gone here and drops out without aborting.
        const caseRow = await this.repo.getCase(snapshot.workspaceId, caseId);
        if (!caseRow) continue;
        attempted += 1;

        try {
          const exec = await this.executeCase(caseRow, snapshot, llm);
          const score = scoreCase(exec);
          // Persist the per-case delta row BEFORE the suite terminal status (AC-11).
          // A skill row ALWAYS sets `skillSuiteRunId` (never `suiteRunId`) — the two
          // suite-parent FKs are mutually exclusive by construction.
          await this.repo.insertRun({
            caseId,
            skillSuiteRunId: suiteId,
            actualOutput: exec.delta,
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
          // Either-arm failure (provider error / schema-repair exhausted): the row
          // carries the error + pass=false and the suite CONTINUES (AC-21).
          logger?.warn(
            { suiteId, caseId, err: (err as Error).message },
            'skill-eval: case failed; continuing suite',
          );
          await this.repo.insertRun({
            caseId,
            skillSuiteRunId: suiteId,
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

      // All cases raced away before the loop could read any → SETUP failure.
      if (attempted === 0) {
        await this.repo.setSkillSuiteTerminal(suiteId, {
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

      // Pool micro-averaged DELTA metrics over the SUCCESSFUL cases; total counts
      // every attempted case (failed ones are non-passes), so passed/total is honest.
      const pooled = poolSuite(successes);
      await this.repo.setSkillSuiteTerminal(suiteId, {
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
      logger?.error({ suiteId, err: (err as Error).message }, 'skill-eval: suite setup failed');
      await this.repo
        .setSkillSuiteTerminal(suiteId, {
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
