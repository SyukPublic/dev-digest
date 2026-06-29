import { describe, it, expect } from "vitest";
import type { PrFile, ReviewRecord, SmartDiffResponse } from "@devdigest/shared";
import { joinSmartDiff } from "./helpers";

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
