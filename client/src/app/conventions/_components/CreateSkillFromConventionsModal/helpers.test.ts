import { describe, it, expect } from "vitest";
import type { ConventionCandidate } from "@devdigest/shared";
import { categorySkillName, planSkillsFromConventions } from "./helpers";

function cand(over: Partial<ConventionCandidate>): ConventionCandidate {
  return {
    id: "c1",
    rule: "Use X",
    evidence_path: "src/a.ts",
    evidence_snippet: "x",
    confidence: 0.9,
    accepted: true,
    category: null,
    source: "llm",
    occurrences: null,
    extracted_at: null,
    ...over,
  };
}

describe("categorySkillName", () => {
  it("slugs repo + category into a stable name", () => {
    expect(categorySkillName("dev-digest", "Formatting")).toBe("dev-digest-conventions-formatting");
  });
  it("collapses non-alphanumerics in the category (e.g. 'Error handling')", () => {
    expect(categorySkillName("dev-digest", "Error handling")).toBe(
      "dev-digest-conventions-error-handling",
    );
  });
  it("falls back to 'repo' for an empty repo name", () => {
    expect(categorySkillName("", "Imports")).toBe("repo-conventions-imports");
  });
});

describe("planSkillsFromConventions", () => {
  it("case 1: one plan per category, sorted, candidates not duplicated across plans", () => {
    const candidates = [
      cand({ id: "1", category: "imports", evidence_path: "b.ts" }),
      cand({ id: "2", category: "formatting", evidence_path: "a.ts" }),
      cand({ id: "3", category: "imports", evidence_path: "c.ts" }),
    ];
    const plans = planSkillsFromConventions("dev-digest", candidates);
    expect(plans.map((p) => p.category)).toEqual(["formatting", "imports"]); // sorted
    expect(plans.map((p) => p.count)).toEqual([1, 2]);
    expect(plans.reduce((n, p) => n + p.count, 0)).toBe(candidates.length); // no overlap
    expect(plans[0]!.name).toBe("dev-digest-conventions-formatting");
    expect(plans[1]!.name).toBe("dev-digest-conventions-imports");
  });

  it("case 2: a single category still yields one plan with the category suffix (D2)", () => {
    const plans = planSkillsFromConventions("dev-digest", [cand({ category: "naming" })]);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.name).toBe("dev-digest-conventions-naming");
  });

  it("case 3: null/blank category groups into 'general' (parity with groupByCategory)", () => {
    const plans = planSkillsFromConventions("dev-digest", [
      cand({ id: "1", category: null }),
      cand({ id: "2", category: "   " }),
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.category).toBe("general");
    expect(plans[0]!.count).toBe(2);
  });

  it("case 4: evidence files are de-duped within a group; empty paths dropped", () => {
    const plans = planSkillsFromConventions("dev-digest", [
      cand({ id: "1", category: "x", evidence_path: "a.ts" }),
      cand({ id: "2", category: "x", evidence_path: "a.ts" }),
      cand({ id: "3", category: "x", evidence_path: "" }),
    ]);
    expect(plans[0]!.evidenceFiles).toEqual(["a.ts"]);
  });

  it("case 5: deterministic — same output (order + content) on repeated calls", () => {
    const candidates = [cand({ id: "1", category: "b" }), cand({ id: "2", category: "a" })];
    const a = planSkillsFromConventions("dev-digest", candidates);
    const b = planSkillsFromConventions("dev-digest", candidates);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("case 6: no accepted candidates → empty plan list", () => {
    expect(planSkillsFromConventions("dev-digest", [])).toEqual([]);
  });
});
