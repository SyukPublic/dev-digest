import { describe, it, expect } from "vitest";
import {
  fmtPct,
  fmtDeltaPts,
  deltaDirection,
  validateEnvelope,
  diffLines,
  synthesizeAddedFilesDiff,
  validateFiles,
} from "./helpers";

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

  it("synthesizeAddedFilesDiff produces the C12 golden add-only diff (AC-7/AC-10)", () => {
    expect(synthesizeAddedFilesDiff([{ path: "src/config.ts", content: "a\nb\nc" }])).toBe(
      "diff --git a/src/config.ts b/src/config.ts\n--- /dev/null\n+++ b/src/config.ts\n@@ -0,0 +1,3 @@\n+a\n+b\n+c",
    );
  });

  it("synthesizeAddedFilesDiff joins multiple files into two diff --git blocks (AC-10)", () => {
    expect(
      synthesizeAddedFilesDiff([
        { path: "a.ts", content: "x" },
        { path: "b.ts", content: "y" },
      ]),
    ).toBe(
      "diff --git a/a.ts b/a.ts\n--- /dev/null\n+++ b/a.ts\n@@ -0,0 +1,1 @@\n+x\n" +
        "diff --git a/b.ts b/b.ts\n--- /dev/null\n+++ b/b.ts\n@@ -0,0 +1,1 @@\n+y",
    );
  });

  it("synthesizeAddedFilesDiff emits a header with NO hunk for empty content (AC-14)", () => {
    expect(synthesizeAddedFilesDiff([{ path: "e.ts", content: "" }])).toBe(
      "diff --git a/e.ts b/e.ts\n--- /dev/null\n+++ b/e.ts",
    );
  });

  it("synthesizeAddedFilesDiff numbers a ≥12-line file so <path>:12 grounds (AC-11)", () => {
    const content = Array.from({ length: 12 }, (_, i) => `line${i + 1}`).join("\n");
    const diff = synthesizeAddedFilesDiff([{ path: "src/config.ts", content }]);
    expect(diff).toContain("@@ -0,0 +1,12 @@");
    // the 12th added line is present and add-marked (parseUnifiedDiff numbers +lines 1..N)
    expect(diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"))).toHaveLength(12);
    expect(diff).toContain("+line12");
  });

  it("validateFiles flags an empty/whitespace-only path (AC-13) and a duplicate path (AC-12)", () => {
    expect(validateFiles([{ path: "a.ts", content: "x" }])).toEqual({ ok: true });
    expect(
      validateFiles([
        { path: "a.ts", content: "x" },
        { path: "b.ts", content: "y" },
      ]),
    ).toEqual({ ok: true });

    expect(validateFiles([{ path: "", content: "x" }])).toEqual({ ok: false, error: "emptyPath" });
    expect(validateFiles([{ path: "   ", content: "x" }])).toEqual({ ok: false, error: "emptyPath" });

    expect(
      validateFiles([
        { path: "a.ts", content: "x" },
        { path: "a.ts", content: "y" },
      ]),
    ).toEqual({ ok: false, error: "duplicatePath", duplicatePath: "a.ts" });
  });

  it("validateFiles allows empty CONTENT (author-time emptiness, AC-14)", () => {
    expect(validateFiles([{ path: "e.ts", content: "" }])).toEqual({ ok: true });
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
