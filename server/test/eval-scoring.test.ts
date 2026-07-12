import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Finding, EvalExpectedOutput } from '@devdigest/shared';
import {
  matchesExpectation,
  caseCounts,
  casePass,
  scoreCase,
  poolSuite,
  aggregateCost,
  regressionAlert,
  type CaseRunResult,
} from '../src/modules/eval/scoring.js';

/** A minimal grounded finding at file/lines (other fields are irrelevant to scoring). */
function mkFinding(file: string, start: number, end: number, extra?: Partial<Finding>): Finding {
  return {
    id: crypto.randomUUID(),
    severity: 'WARNING',
    category: 'bug',
    title: 'x',
    file,
    start_line: start,
    end_line: end,
    rationale: 'r',
    confidence: 0.9,
    ...extra,
  };
}

const mustFind = (findings: EvalExpectedOutput['findings']): EvalExpectedOutput => ({
  expectation: 'must_find',
  findings,
});
const mustNotFlag = (findings: EvalExpectedOutput['findings']): EvalExpectedOutput => ({
  expectation: 'must_not_flag',
  findings,
});

describe('matchesExpectation — AC-15', () => {
  it('matches on file EQUALITY + range INTERSECTION', () => {
    expect(matchesExpectation(mkFinding('a.ts', 10, 12), { file: 'a.ts', start_line: 11, end_line: 20 })).toBe(true);
  });
  it('rejects a different file', () => {
    expect(matchesExpectation(mkFinding('a.ts', 10, 12), { file: 'b.ts', start_line: 10, end_line: 12 })).toBe(false);
  });
  it('rejects a disjoint range', () => {
    expect(matchesExpectation(mkFinding('a.ts', 10, 12), { file: 'a.ts', start_line: 20, end_line: 30 })).toBe(false);
  });
  it('severity / category / title never affect matching', () => {
    const f = mkFinding('a.ts', 10, 12, { severity: 'CRITICAL', category: 'security', title: 'zzz' });
    expect(
      matchesExpectation(f, {
        file: 'a.ts',
        start_line: 10,
        end_line: 12,
        severity: 'SUGGESTION',
        category: 'style',
        title: 'different',
      }),
    ).toBe(true);
  });
});

describe('per-case pass — AC-17', () => {
  it('must_find passes iff ALL expected findings matched', () => {
    const result: CaseRunResult = {
      expected: mustFind([
        { file: 'a.ts', start_line: 10, end_line: 12 },
        { file: 'b.ts', start_line: 1, end_line: 2 },
      ]),
      findings: [mkFinding('a.ts', 10, 11)],
      dropped: 0,
      costUsd: 0,
    };
    expect(casePass(result)).toBe(false);
    const full: CaseRunResult = { ...result, findings: [mkFinding('a.ts', 10, 11), mkFinding('b.ts', 1, 2)] };
    expect(casePass(full)).toBe(true);
  });
  it('must_not_flag passes iff zero noise', () => {
    const clean: CaseRunResult = { expected: mustNotFlag([]), findings: [], dropped: 0, costUsd: 0 };
    expect(casePass(clean)).toBe(true);
    const noisy: CaseRunResult = { expected: mustNotFlag([]), findings: [mkFinding('a.ts', 1, 1)], dropped: 0, costUsd: 0 };
    expect(casePass(noisy)).toBe(false);
  });
});

describe('pooled micro-averaged metrics — AC-16', () => {
  it('recall = matched must_find / all must_find (pooled)', () => {
    const results: CaseRunResult[] = [
      { expected: mustFind([{ file: 'a.ts', start_line: 10, end_line: 12 }]), findings: [mkFinding('a.ts', 10, 11)], dropped: 0, costUsd: 0 },
      { expected: mustFind([{ file: 'b.ts', start_line: 1, end_line: 2 }]), findings: [], dropped: 0, costUsd: 0 },
    ];
    expect(poolSuite(results).recall).toBe(0.5);
  });

  it('precision = 1 − noise/total; a clean-fixture (empty must_not_flag) counts every finding as noise', () => {
    const results: CaseRunResult[] = [
      // must_find case: one matched finding (counts toward total, not noise).
      { expected: mustFind([{ file: 'a.ts', start_line: 10, end_line: 12 }]), findings: [mkFinding('a.ts', 10, 11)], dropped: 0, costUsd: 0 },
      // clean fixture: one produced finding → noise.
      { expected: mustNotFlag([]), findings: [mkFinding('b.ts', 5, 5)], dropped: 0, costUsd: 0 },
    ];
    // total = 2 findings, noise = 1 → precision = 0.5
    expect(poolSuite(results).precision).toBe(0.5);
  });

  it('findings outside any expected / must_not_flag region do NOT penalize precision', () => {
    const results: CaseRunResult[] = [
      // must_not_flag with a specific region; a finding elsewhere is not noise.
      { expected: mustNotFlag([{ file: 'a.ts', start_line: 100, end_line: 110 }]), findings: [mkFinding('a.ts', 1, 2)], dropped: 0, costUsd: 0 },
    ];
    expect(poolSuite(results).precision).toBe(1); // noise 0 / total 1
  });

  it('citation_accuracy = Σ kept / Σ (kept + dropped)', () => {
    const results: CaseRunResult[] = [
      { expected: mustFind([{ file: 'a.ts', start_line: 1, end_line: 1 }]), findings: [mkFinding('a.ts', 1, 1), mkFinding('a.ts', 2, 2)], dropped: 1, costUsd: 0 },
      { expected: mustFind([{ file: 'b.ts', start_line: 1, end_line: 1 }]), findings: [mkFinding('b.ts', 1, 1)], dropped: 1, costUsd: 0 },
    ];
    // kept = 3, dropped = 2, preGate = 5 → 3/5 = 0.6
    expect(poolSuite(results).citation_accuracy).toBeCloseTo(0.6);
  });

  it('passed / total tallies per-case pass', () => {
    const results: CaseRunResult[] = [
      { expected: mustFind([{ file: 'a.ts', start_line: 1, end_line: 1 }]), findings: [mkFinding('a.ts', 1, 1)], dropped: 0, costUsd: 0 },
      { expected: mustNotFlag([]), findings: [mkFinding('b.ts', 1, 1)], dropped: 0, costUsd: 0 },
    ];
    const pooled = poolSuite(results);
    expect(pooled.passed).toBe(1);
    expect(pooled.total).toBe(2);
  });
});

describe('null-denominator rule — AC-18', () => {
  it('recall null with zero must_find expectations', () => {
    const results: CaseRunResult[] = [{ expected: mustNotFlag([]), findings: [], dropped: 0, costUsd: 0 }];
    expect(poolSuite(results).recall).toBeNull();
  });
  it('precision null with zero total findings', () => {
    const results: CaseRunResult[] = [{ expected: mustFind([{ file: 'a.ts', start_line: 1, end_line: 1 }]), findings: [], dropped: 0, costUsd: 0 }];
    expect(poolSuite(results).precision).toBeNull();
  });
  it('citation null with zero pre-gate findings', () => {
    const results: CaseRunResult[] = [{ expected: mustFind([{ file: 'a.ts', start_line: 1, end_line: 1 }]), findings: [], dropped: 0, costUsd: 0 }];
    expect(poolSuite(results).citation_accuracy).toBeNull();
  });
  it('scoreCase applies the null rule per case too', () => {
    const score = scoreCase({ expected: mustNotFlag([]), findings: [], dropped: 0, costUsd: 0 });
    expect(score.recall).toBeNull();
    expect(score.precision).toBeNull();
    expect(score.citation_accuracy).toBeNull();
  });
});

describe('cost aggregation — AC-20', () => {
  it('suite cost = sum of priced cases', () => {
    const results: CaseRunResult[] = [
      { expected: mustFind([]), findings: [], dropped: 0, costUsd: 0.01 },
      { expected: mustFind([]), findings: [], dropped: 0, costUsd: 0.02 },
    ];
    expect(poolSuite(results).cost_usd).toBeCloseTo(0.03);
  });
  it('suite cost null when NO case was priced (never 0)', () => {
    const results: CaseRunResult[] = [{ expected: mustFind([]), findings: [], dropped: 0, costUsd: null }];
    expect(poolSuite(results).cost_usd).toBeNull();
  });
  it('aggregateCost: null when none priced; sum otherwise', () => {
    expect(aggregateCost([null, null])).toBeNull();
    expect(aggregateCost([0.5, null, 0.25])).toBeCloseTo(0.75);
  });
  it('an unknown component leaves the case cost null (from the outcome)', () => {
    expect(scoreCase({ expected: mustFind([]), findings: [], dropped: 0, costUsd: null }).cost_usd).toBeNull();
  });
});

describe('regressionAlert — AC-35', () => {
  it('reports the largest single-metric drop naming the latest version', () => {
    const alert = regressionAlert([
      { agent_version: 7, recall: 0.9, precision: 0.85, citation_accuracy: 0.95 },
      { agent_version: 6, recall: 0.9, precision: 0.87, citation_accuracy: 0.95 },
    ]);
    expect(alert).toBe('Precision dipped 2pts on v7');
  });
  it('null with fewer than two completed runs', () => {
    expect(regressionAlert([])).toBeNull();
    expect(regressionAlert([{ agent_version: 1, recall: 1, precision: 1, citation_accuracy: 1 }])).toBeNull();
  });
  it('null when no metric regressed', () => {
    expect(
      regressionAlert([
        { agent_version: 2, recall: 0.95, precision: 0.95, citation_accuracy: 0.95 },
        { agent_version: 1, recall: 0.9, precision: 0.9, citation_accuracy: 0.9 },
      ]),
    ).toBeNull();
  });
});

describe('scoring module is LLM-free — AC-36 / T10', () => {
  it('has no provider / container / LLM reference in its CODE (comments stripped)', () => {
    const raw = readFileSync(fileURLToPath(new URL('../src/modules/eval/scoring.ts', import.meta.url)), 'utf8');
    // Strip block + line comments so the assertion is about executable code, not prose.
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/container\./);
    expect(code).not.toMatch(/\.llm\(/);
    expect(code).not.toMatch(/completeStructured/);
    expect(code).not.toMatch(/reviewPullRequest/);
    expect(code).not.toMatch(/adapters\/llm/);
    // Its only import is a TYPE import from the contracts barrel (no value imports).
    expect(code).toMatch(/import type \{[^}]*\} from '@devdigest\/shared'/);
    expect(code).not.toMatch(/^\s*import\s+\{/m);
  });

  it('caseCounts is a pure synchronous transform', () => {
    const counts = caseCounts({ expected: mustFind([{ file: 'a.ts', start_line: 1, end_line: 1 }]), findings: [mkFinding('a.ts', 1, 1)], dropped: 0, costUsd: 0 });
    expect(counts.expectedMustFind).toBe(1);
    expect(counts.matchedMustFind).toBe(1);
  });
});
