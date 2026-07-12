import { describe, it, expect } from "vitest";
import { fmtPct, fmtDeltaPts, deltaDirection, validateEnvelope, diffLines } from "./helpers";

describe("eval helpers", () => {
  it("fmtPct renders '—' for null and a rounded percent otherwise (AC-18)", () => {
    expect(fmtPct(null)).toBe("—");
    expect(fmtPct(undefined)).toBe("—");
    expect(fmtPct(0.5)).toBe("50%");
    expect(fmtPct(0.874)).toBe("87%");
  });

  it("fmtDeltaPts + deltaDirection convey direction without color", () => {
    expect(fmtDeltaPts(0.02)).toBe("+2pts");
    expect(fmtDeltaPts(-0.01)).toBe("-1pt");
    expect(fmtDeltaPts(null)).toBe("");
    expect(deltaDirection(0.01)).toBe("up");
    expect(deltaDirection(-0.01)).toBe("down");
    expect(deltaDirection(0)).toBe("flat");
    expect(deltaDirection(null)).toBe("flat");
  });

  it("validateEnvelope: accepts a valid envelope, rejects bad JSON + bad shape (AC-31)", () => {
    expect(validateEnvelope(`{"expectation":"must_find","findings":[]}`).ok).toBe(true);
    expect(
      validateEnvelope(`{"expectation":"must_not_flag","findings":[{"file":"a.ts","start_line":1,"end_line":2}]}`).ok,
    ).toBe(true);
    expect(validateEnvelope("not json").ok).toBe(false);
    expect(validateEnvelope(`{"expectation":"maybe","findings":[]}`).ok).toBe(false);
    expect(validateEnvelope(`{"expectation":"must_find","findings":[{"file":"a.ts"}]}`).ok).toBe(false);
    expect(validateEnvelope(`{"expectation":"must_find"}`).ok).toBe(false);
  });

  it("diffLines marks added/removed lines (system-prompt diff)", () => {
    const out = diffLines("a\nb\nc", "a\nX\nc");
    expect(out).toEqual([
      { kind: "ctx", text: "a" },
      { kind: "del", text: "b" },
      { kind: "add", text: "X" },
      { kind: "ctx", text: "c" },
    ]);
  });
});
