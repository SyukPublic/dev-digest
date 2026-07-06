import { describe, it, expect } from "vitest";
import type { PrFile, ReviewRecord, SmartDiffResponse } from "@devdigest/shared";
import { parsePatch } from "@/components/diff-viewer/helpers";
import { joinSmartDiff, firstRenderedLineInRange, renderedLinesInRange } from "./helpers";

// Minimal smart-diff: one core file. Its additions/deletions DELIBERATELY differ
// from the PrFile below so we can prove which source the counts come from.
const SMART_DIFF = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "server/src/service.ts",
          pseudocode_summary: null,
          additions: 12, // stale (saved pr_files) — must be IGNORED when PrFile present
          deletions: 3,
          finding_lines: [],
        },
        {
          path: "server/src/only-in-smartdiff.ts",
          pseudocode_summary: null,
          additions: 7,
          deletions: 1,
          finding_lines: [],
        },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
} as unknown as SmartDiffResponse;

// Fresh getDetail payload: same path, but the up-to-date counts + the patch.
const FILES = [
  { path: "server/src/service.ts", additions: 50, deletions: 0, patch: "@@ -0,0 +1,50 @@\n+x" },
] as unknown as PrFile[];

const REVIEWS: ReviewRecord[] | undefined = undefined;

describe("joinSmartDiff — counts source consistency (Issue #1A)", () => {
  it("sources additions/deletions AND patch from PrFile (the fresh getDetail), not the saved smart-diff", () => {
    const groups = joinSmartDiff(SMART_DIFF, FILES, REVIEWS);
    const file = groups[0]!.files.find((f) => f.path === "server/src/service.ts")!;

    // Counts come from PrFile (50/0), NOT the smart-diff's stale 12/3.
    expect(file.additions).toBe(50);
    expect(file.deletions).toBe(0);
    // Patch is from the same PrFile source (so +/- and patch never disagree).
    expect(file.patch).toBe("@@ -0,0 +1,50 @@\n+x");
  });

  it("falls back to the smart-diff counts when a path is absent from PrFile (binary / not fetched)", () => {
    const groups = joinSmartDiff(SMART_DIFF, FILES, REVIEWS);
    // This path has NO PrFile entry → counts fall back to smart-diff; patch is null.
    const file = groups[0]!.files.find((f) => f.path === "server/src/only-in-smartdiff.ts")!;

    expect(file.additions).toBe(7);
    expect(file.deletions).toBe(1);
    expect(file.patch).toBeNull();
  });
});

// A patch rendering new-side lines 1..8 (a single +1,8 hunk).
const RANGE_PATCH =
  "@@ -1,3 +1,8 @@\n+const a = 1;\n+const b = 2;\n+const c = 3;\n+const d = 4;\n+const e = 5;\n+const f = 6;\n+const g = 7;\n+const h = 8;";

describe("firstRenderedLineInRange / renderedLinesInRange — deep-link range helpers (T9 → AC-7/AC-8)", () => {
  it("returns the FIRST rendered new-side line and the full rendered set for a range inside the hunks (AC-7)", () => {
    const lines = parsePatch(RANGE_PATCH);
    expect(renderedLinesInRange(lines, 4, 6)).toEqual([4, 5, 6]);
    expect(firstRenderedLineInRange(lines, 4, 6)).toBe(4);
  });

  it("handles a single-line target (start === end)", () => {
    const lines = parsePatch(RANGE_PATCH);
    expect(renderedLinesInRange(lines, 5, 5)).toEqual([5]);
    expect(firstRenderedLineInRange(lines, 5, 5)).toBe(5);
  });

  it("clamps a range partly outside the rendered hunks to what IS rendered (AC-8)", () => {
    const lines = parsePatch(RANGE_PATCH);
    // Lines 6..20 → only 6,7,8 are rendered; first is 6.
    expect(renderedLinesInRange(lines, 6, 20)).toEqual([6, 7, 8]);
    expect(firstRenderedLineInRange(lines, 6, 20)).toBe(6);
  });

  it("returns null / empty when NO line of the range is rendered (AC-8 header fallback)", () => {
    const lines = parsePatch(RANGE_PATCH);
    expect(renderedLinesInRange(lines, 40, 50)).toEqual([]);
    expect(firstRenderedLineInRange(lines, 40, 50)).toBeNull();
  });

  it("normalizes a reversed range without looping unbounded", () => {
    const lines = parsePatch(RANGE_PATCH);
    expect(renderedLinesInRange(lines, 6, 4)).toEqual([4, 5, 6]);
    expect(firstRenderedLineInRange(lines, 6, 4)).toBe(4);
  });
});
