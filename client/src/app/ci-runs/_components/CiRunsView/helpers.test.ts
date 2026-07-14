import { describe, it, expect } from "vitest";
import type { CiRunSummary } from "@devdigest/shared";
import { distinct, findingCountsOf, formatDuration, formatTimestamp, prUrl, statusOf } from "./helpers";

/**
 * Pure derivation-helper tests for the CI Runs table (AC-34 / test_ci_runs_row).
 *
 * `CiRunSummary` carries only `findings_count` + `blockers` (no per-severity
 * breakdown), so `findingCountsOf` DERIVES a critical/warning split from those
 * two fields — this is exactly the untested logic behind the "severity-colored
 * finding counts" the Findings column renders via `SeverityCountBadges`. These
 * tests pin that derivation down at the unit level (no DOM ambiguity).
 */
function makeRun(over: Partial<CiRunSummary> = {}): CiRunSummary {
  return {
    run_id: "r1",
    agent_id: "a1",
    agent_name: "Reviewer A",
    provider: "openrouter",
    model: "gpt-x",
    status: "done",
    error: null,
    duration_ms: 7420,
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: 0.012,
    findings_count: 3,
    grounding: null,
    ran_at: "2026-07-14T10:00:00.000Z",
    score: 88,
    blockers: 1,
    source: "ci",
    repo: "acme/api",
    pr_number: 12,
    github_url: "https://github.com/acme/api/actions/runs/999",
    ci_installation_id: "inst1",
    ...over,
  };
}

describe("findingCountsOf (AC-34 severity split)", () => {
  it("input: findings_count=3, blockers=1 → CRITICAL=1, WARNING=2 (blockers map to CRITICAL, remainder to WARNING)", () => {
    const run = makeRun({ findings_count: 3, blockers: 1 });
    expect(findingCountsOf(run)).toEqual({ CRITICAL: 1, WARNING: 2, SUGGESTION: 0 });
  });

  it("input: findings_count=0 → null (renders the '—' empty cell, not a zeroed badge set)", () => {
    const run = makeRun({ findings_count: 0, blockers: 0 });
    expect(findingCountsOf(run)).toBeNull();
  });

  it("input: findings_count=null → null (missing data reads the same as zero findings)", () => {
    const run = makeRun({ findings_count: null, blockers: null });
    expect(findingCountsOf(run)).toBeNull();
  });

  it("input: blockers exceeds findings_count (defensive) → CRITICAL is capped at the total, WARNING never negative", () => {
    const run = makeRun({ findings_count: 2, blockers: 5 });
    const counts = findingCountsOf(run)!;
    expect(counts.CRITICAL).toBe(2);
    expect(counts.WARNING).toBe(0);
    expect(counts.WARNING).toBeGreaterThanOrEqual(0);
  });

  it("input: blockers=null, findings_count=4 → all findings read as WARNING (no crash on null blockers)", () => {
    const run = makeRun({ findings_count: 4, blockers: null });
    expect(findingCountsOf(run)).toEqual({ CRITICAL: 0, WARNING: 4, SUGGESTION: 0 });
  });
});

describe("statusOf (display status derivation)", () => {
  it("input: status='running' → 'running' regardless of findings", () => {
    expect(statusOf(makeRun({ status: "running", findings_count: 5 }))).toBe("running");
  });

  it("input: status='failed' → 'failed'", () => {
    expect(statusOf(makeRun({ status: "failed" }))).toBe("failed");
  });

  it("input: status='cancelled' → 'failed' (crashed/cancelled reads the same)", () => {
    expect(statusOf(makeRun({ status: "cancelled" }))).toBe("failed");
  });

  it("input: status='done', findings_count=3 → 'succeeded' (did its job, posted findings)", () => {
    expect(statusOf(makeRun({ status: "done", findings_count: 3 }))).toBe("succeeded");
  });

  it("input: status='done', findings_count=0 → 'noFindings' (clean PR)", () => {
    expect(statusOf(makeRun({ status: "done", findings_count: 0 }))).toBe("noFindings");
  });
});

describe("formatDuration", () => {
  it("input: null → '—'", () => expect(formatDuration(null)).toBe("—"));
  it("input: 7420 → '7.4s'", () => expect(formatDuration(7420)).toBe("7.4s"));
  it("input: 74210 → '1m 14s'", () => expect(formatDuration(74210)).toBe("1m 14s"));
  it("input: 500 (sub-second) → '500ms'", () => expect(formatDuration(500)).toBe("500ms"));
});

describe("prUrl", () => {
  it("input: repo='acme/api', pr_number=12 → the GitHub PR URL", () => {
    expect(prUrl("acme/api", 12)).toBe("https://github.com/acme/api/pull/12");
  });
  it("input: repo=null → null (no link to build)", () => {
    expect(prUrl(null, 12)).toBeNull();
  });
  it("input: pr_number=null → null", () => {
    expect(prUrl("acme/api", null)).toBeNull();
  });
});

describe("formatTimestamp", () => {
  it("input: null → '—'", () => expect(formatTimestamp(null)).toBe("—"));
  it("input: a valid ISO string → a non-empty locale string", () => {
    const out = formatTimestamp("2026-07-14T10:00:00.000Z");
    expect(out).not.toBe("—");
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("distinct", () => {
  it("input: runs with repeated + null agent_name → sorted unique non-null values", () => {
    const runs = [
      makeRun({ agent_name: "Reviewer B" }),
      makeRun({ agent_name: "Reviewer A" }),
      makeRun({ agent_name: "Reviewer A" }),
      makeRun({ agent_name: null }),
    ];
    expect(distinct(runs, "agent_name")).toEqual(["Reviewer A", "Reviewer B"]);
  });
});
