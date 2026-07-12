/**
 * Pure-function tests for the deterministic grounding scorer — no model.
 *   pnpm vitest run src/scoring/pattern-match.test.ts
 */

import { describe, expect, test } from "vitest";
import { patternMatch } from "./pattern-match.js";

describe("patternMatch", () => {
  test("empty expectations → 1 (vacuous pass)", () => {
    expect(patternMatch("anything", [])).toBe(1);
  });

  test("string slots: fraction present, case-insensitive", () => {
    expect(patternMatch("Use safeParse at the edge", ["safeparse", "flatten"])).toBe(0.5);
    expect(patternMatch("SafeParse + error.flatten()", ["safeparse", "flatten"])).toBe(1);
  });

  test("alternative slot passes when ANY alternative appears", () => {
    const alts = [["dependency-cruiser", "arch:check"]];
    expect(patternMatch("run pnpm arch:check in CI", alts)).toBe(1);
    expect(patternMatch("dependency-cruiser forbidden rules", alts)).toBe(1);
    expect(patternMatch("keep boundaries via code review", alts)).toBe(0);
  });

  test("mixed string and alternative slots score per slot", () => {
    const expected = ["transaction", ["dependency-cruiser", "arch:check"]];
    expect(patternMatch("wrap it in a transaction", expected)).toBe(0.5);
    expect(patternMatch("a transaction, gated by arch:check", expected)).toBe(1);
  });
});
