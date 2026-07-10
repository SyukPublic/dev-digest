import type { Finding, EvalExpectedOutput, EvalExpectedFinding } from '@devdigest/shared';

/**
 * L06 Agent Eval Pipeline — the PURE, deterministic scoring heart.
 *
 * NO LLM, no I/O, no `container`/provider reference: every function here is a
 * pure transform over an already-produced set of grounded findings + the case's
 * `expected_output` envelope (AC-15, AC-16, AC-17, AC-18, AC-20, AC-35, AC-36).
 * A hostile diff or `expected_output` can only make the engine emit findings; it
 * can never influence a metric here beyond that.
 *
 * Terminology:
 *  - grounded findings = `ReviewOutcome.review.findings` (survived the citation gate);
 *  - dropped           = `ReviewOutcome.dropped.length` (failed the citation gate);
 *  - a MATCH (AC-15)   = finding.file EQUALS expected.file AND line ranges INTERSECT.
 */

/** Minimal per-case input the scorer consumes — a stubbed `ReviewOutcome` slice. */
export interface CaseRunResult {
  /** The case's expected-output envelope. */
  expected: EvalExpectedOutput;
  /** Grounded/kept findings (`ReviewOutcome.review.findings`). */
  findings: Finding[];
  /** How many findings the grounding gate DROPPED (`ReviewOutcome.dropped.length`). */
  dropped: number;
  /** `ReviewOutcome.costUsd` — null when any cost component was unknown (AC-20). */
  costUsd: number | null;
}

/** Raw per-case counts, summed across the suite for pooled micro-averaging. */
export interface CaseCounts {
  /** must_find expectations in this case (0 for a must_not_flag case). */
  expectedMustFind: number;
  /** must_find expectations matched by at least one grounded finding. */
  matchedMustFind: number;
  /** Findings counted as noise against precision (must_not_flag only). */
  noise: number;
  /** All grounded findings this case produced (precision denominator term). */
  totalFindings: number;
  /** Grounded findings kept (citation numerator term). */
  kept: number;
  /** Pre-gate findings = kept + dropped (citation denominator term). */
  preGate: number;
}

/** Per-case score persisted on the `eval_runs` row. */
export interface CaseScore {
  pass: boolean;
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
  cost_usd: number | null;
  /** How many findings the run produced (grounded). */
  actual_count: number;
  counts: CaseCounts;
}

/** Pooled (micro-averaged) suite metrics. */
export interface SuiteScore {
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
  passed: number;
  total: number;
  cost_usd: number | null;
}

/**
 * T4 / AC-15 — a finding matches an expected finding iff the FILE is equal AND
 * the `[start_line, end_line]` ranges INTERSECT. severity/category/title are
 * informative only and never affect matching.
 */
export function matchesExpectation(finding: Finding, expected: EvalExpectedFinding): boolean {
  if (finding.file !== expected.file) return false;
  return rangesIntersect(finding.start_line, finding.end_line, expected.start_line, expected.end_line);
}

function rangesIntersect(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  const aLo = Math.min(aStart, aEnd);
  const aHi = Math.max(aStart, aEnd);
  const bLo = Math.min(bStart, bEnd);
  const bHi = Math.max(bStart, bEnd);
  return aLo <= bHi && bLo <= aHi;
}

/**
 * Raw counts for one case (the atoms both per-case metrics and suite pooling are
 * derived from). Findings OUTSIDE any expected / must_not_flag region are
 * ignored — they never penalize precision (AC-16).
 */
export function caseCounts(result: CaseRunResult): CaseCounts {
  const { expected, findings, dropped } = result;
  const kept = findings.length;
  const preGate = kept + Math.max(0, dropped);
  const totalFindings = kept;

  if (expected.expectation === 'must_find') {
    // Recall bucket: each expected finding matched by ANY grounded finding.
    const matchedMustFind = expected.findings.filter((exp) =>
      findings.some((f) => matchesExpectation(f, exp)),
    ).length;
    // must_find findings never contribute noise (AC-16).
    return {
      expectedMustFind: expected.findings.length,
      matchedMustFind,
      noise: 0,
      totalFindings,
      kept,
      preGate,
    };
  }

  // must_not_flag: an EMPTY findings[] is a clean fixture where ANY finding is
  // noise; otherwise noise = findings intersecting a must_not_flag region.
  const noise =
    expected.findings.length === 0
      ? findings.length
      : findings.filter((f) => expected.findings.some((exp) => matchesExpectation(f, exp))).length;
  return {
    expectedMustFind: 0,
    matchedMustFind: 0,
    noise,
    totalFindings,
    kept,
    preGate,
  };
}

/**
 * T6 / AC-17 — per-case pass:
 *  - must_find passes iff ALL its expected findings matched;
 *  - must_not_flag passes iff zero noise.
 */
export function casePass(result: CaseRunResult, counts = caseCounts(result)): boolean {
  if (result.expected.expectation === 'must_find') {
    return counts.matchedMustFind === counts.expectedMustFind;
  }
  return counts.noise === 0;
}

/**
 * Per-case score (metrics stored on the `eval_runs` row). Null-denominator rule
 * applies per case too (AC-18): recall null with no must_find expectations,
 * precision null with no findings, citation null with no pre-gate findings.
 */
export function scoreCase(result: CaseRunResult): CaseScore {
  const counts = caseCounts(result);
  return {
    pass: casePass(result, counts),
    recall: counts.expectedMustFind === 0 ? null : counts.matchedMustFind / counts.expectedMustFind,
    precision: counts.totalFindings === 0 ? null : 1 - counts.noise / counts.totalFindings,
    citation_accuracy: counts.preGate === 0 ? null : counts.kept / counts.preGate,
    cost_usd: result.costUsd,
    actual_count: counts.kept,
    counts,
  };
}

/**
 * T5 / T7 / T8 — pool the suite's micro-averaged metrics from the raw per-case
 * counts (NOT by averaging the per-case metrics). Zero denominators yield null
 * (AC-18); suite cost is the sum of priced cases, or null when none priced (AC-20).
 */
export function poolSuite(results: CaseRunResult[]): SuiteScore {
  let expectedMustFind = 0;
  let matchedMustFind = 0;
  let noise = 0;
  let totalFindings = 0;
  let kept = 0;
  let preGate = 0;
  let passed = 0;
  let costSum = 0;
  let anyPriced = false;

  for (const result of results) {
    const counts = caseCounts(result);
    expectedMustFind += counts.expectedMustFind;
    matchedMustFind += counts.matchedMustFind;
    noise += counts.noise;
    totalFindings += counts.totalFindings;
    kept += counts.kept;
    preGate += counts.preGate;
    if (casePass(result, counts)) passed += 1;
    if (result.costUsd != null) {
      anyPriced = true;
      costSum += result.costUsd;
    }
  }

  return {
    recall: expectedMustFind === 0 ? null : matchedMustFind / expectedMustFind,
    precision: totalFindings === 0 ? null : 1 - noise / totalFindings,
    citation_accuracy: preGate === 0 ? null : kept / preGate,
    passed,
    total: results.length,
    cost_usd: anyPriced ? costSum : null,
  };
}

/**
 * T8 / AC-20 — the suite cost of a set of already-scored/persisted per-case
 * costs: sum of the priced ones, or null when none was priced (never 0).
 */
export function aggregateCost(costs: (number | null)[]): number | null {
  const priced = costs.filter((c): c is number => c != null);
  if (priced.length === 0) return null;
  return priced.reduce((a, b) => a + b, 0);
}

const METRIC_LABEL: Record<'recall' | 'precision' | 'citation_accuracy', string> = {
  recall: 'Recall',
  precision: 'Precision',
  citation_accuracy: 'Citation',
};

/** The two-latest-completed-runs slice the alert compares. */
export interface CompletedRunMetrics {
  agent_version: number;
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
}

/**
 * T9 / AC-35 — the deterministic regression banner, computed IN CODE (no LLM)
 * from the two latest COMPLETED runs (`completed[0]` newest). Returns the
 * largest single-metric drop as e.g. "Precision dipped 2pts on v7", or null when
 * there are fewer than two completed runs or no metric regressed by >= 1pt.
 */
export function regressionAlert(completed: CompletedRunMetrics[]): string | null {
  if (completed.length < 2) return null;
  const [latest, previous] = completed;
  if (!latest || !previous) return null;

  let worst: { metric: keyof typeof METRIC_LABEL; pts: number } | null = null;
  for (const metric of ['recall', 'precision', 'citation_accuracy'] as const) {
    const cur = latest[metric];
    const prev = previous[metric];
    if (cur == null || prev == null) continue;
    const pts = Math.round((prev - cur) * 100);
    if (pts >= 1 && (!worst || pts > worst.pts)) worst = { metric, pts };
  }
  if (!worst) return null;
  return `${METRIC_LABEL[worst.metric]} dipped ${worst.pts}pt${worst.pts === 1 ? '' : 's'} on v${latest.agent_version}`;
}
