import type { Finding, EvalExpectedOutput, EvalSkillCaseDelta } from '@devdigest/shared';
import { matchesExpectation } from './scoring.js';

/**
 * Skill Eval Pipeline — PURE delta computation + classification
 * (SPEC-2026-07-12-skill-eval-differential).
 *
 * A skill has no model/prompt/strategy, so it is only meaningful as a DELTA on a
 * host agent's review: run the host twice over a case's stored diff — WITHOUT the
 * skill (baseline arm) and WITH it — and keep the findings the skill CAUSED
 * (present WITH, absent WITHOUT). Everything here is a pure transform over two
 * already-produced arm outcomes; NO `container`, NO LLM, NO I/O (AC-33). The
 * resulting delta finding set + delta dropped count are then fed to the UNCHANGED
 * L06 scorer (`scoring.ts`) — this module writes NO metric math of its own.
 *
 * The finding↔finding match reuses the SAME notion as the scorer's
 * `matchesExpectation`: file EQUALITY + `[start_line, end_line]` INTERSECTION;
 * severity/category/title are informative only and never affect matching (AC-10).
 */

/** One arm's outcome, reduced to the two finding sets the delta cares about. */
export interface DeltaArm {
  /** Grounded/kept findings (`ReviewOutcome.review.findings`). */
  findings: Finding[];
  /** Pre-gate DROPPED findings (`ReviewOutcome.dropped.map(d => d.finding)`). */
  dropped: Finding[];
}

/** The delta the scorer consumes: findings the skill CAUSED + count it caused to drop. */
export interface Delta {
  /** WITH-arm grounded findings that match NO WITHOUT-arm grounded finding. */
  findings: Finding[];
  /** WITH-arm dropped findings that match NO WITHOUT-arm dropped finding (count). */
  dropped: number;
}

/**
 * T10 / AC-10 — two findings MATCH iff their FILE is equal AND their
 * `[start_line, end_line]` ranges INTERSECT. Delegates to the scorer's
 * `matchesExpectation` so the range notion is single-sourced (a `Finding` is
 * structurally an `EvalExpectedFinding` for matching); severity/category/title are
 * informative only.
 */
export function findingsMatch(a: Finding, b: Finding): boolean {
  return matchesExpectation(a, b);
}

/**
 * T10 / AC-10, AC-33 — the pure delta of a differential run: the WITH-arm findings
 * ATTRIBUTABLE to the skill (present WITH, matching no WITHOUT finding) and the
 * count of pre-gate findings the skill newly caused to be dropped. Symmetric
 * matching per set (grounded↔grounded, dropped↔dropped). NO LLM, NO I/O.
 */
export function computeDelta(withArm: DeltaArm, withoutArm: DeltaArm): Delta {
  const findings = withArm.findings.filter(
    (w) => !withoutArm.findings.some((b) => findingsMatch(w, b)),
  );
  const dropped = withArm.dropped.filter(
    (w) => !withoutArm.dropped.some((b) => findingsMatch(w, b)),
  ).length;
  return { findings, dropped };
}

/**
 * T11 / AC-30, AC-13 — classify one delta finding against the case's
 * `expected_output`, mirroring the scorer's `caseCounts` buckets:
 *  - `caught`  — the case is `must_find` and the finding matches an expectation;
 *  - `noise`   — the case is `must_not_flag` AND the finding intersects a
 *                must_not_flag region, OR the fixture is clean (empty `findings[]`
 *                → ANY finding is noise);
 *  - `ignored` — neither (informative; never penalizes recall or precision).
 *
 * `must_find` findings never contribute noise (AC-13); a `must_find` finding that
 * matches no expectation is `ignored`, not `noise`.
 */
export function classifyDelta(
  finding: Finding,
  expected: EvalExpectedOutput,
): EvalSkillCaseDelta['findings'][number]['classification'] {
  if (expected.expectation === 'must_find') {
    return expected.findings.some((exp) => matchesExpectation(finding, exp)) ? 'caught' : 'ignored';
  }
  // must_not_flag: an EMPTY findings[] is a clean fixture where ANY finding is
  // noise; otherwise noise = findings intersecting a must_not_flag region.
  if (expected.findings.length === 0) return 'noise';
  return expected.findings.some((exp) => matchesExpectation(finding, exp)) ? 'noise' : 'ignored';
}

/**
 * T12 / T30 / AC-18 — combine the two arms' per-case cost. Unknown is NEVER
 * treated as 0: if EITHER arm's cost is null the combined cost is null (mirrors
 * the engine's own cost rule).
 */
export function combineCost(a: number | null, b: number | null): number | null {
  return a == null || b == null ? null : a + b;
}
