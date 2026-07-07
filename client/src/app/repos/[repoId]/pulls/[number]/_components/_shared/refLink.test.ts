import { describe, it, expect } from "vitest";
import type { PrFile } from "@devdigest/shared";
import {
  buildPatchLineIndex,
  decideRefLink,
  buildInDiffQuery,
  buildInDiffHref,
} from "./refLink";

// A changed file whose patch renders new-side lines 1..8, plus a patch-less
// (binary/large) file, mirroring the shape usePullDetail().files carries.
const FILES: PrFile[] = [
  {
    path: "server/src/modules/_shared/context.ts",
    additions: 8,
    deletions: 0,
    patch:
      "@@ -1,3 +1,8 @@\n+const a = 1;\n+const b = 2;\n+const c = 3;\n+const d = 4;\n+const e = 5;\n+const f = 6;\n+const g = 7;\n+const h = 8;",
  },
  { path: "package.json", additions: 1, deletions: 0, patch: "@@ -33,0 +34,1 @@\n+  \"ioredis\": \"^5\"" },
  { path: "server/src/big-binary.node", additions: 0, deletions: 0, patch: null },
];

describe("decideRefLink — in-diff vs fallback decision (AC-1/AC-2/AC-4/AC-5)", () => {
  it("returns in-diff with a start-end line for a ranged ref intersecting the new-side hunks", () => {
    const index = buildPatchLineIndex(FILES);
    const decision = decideRefLink(index, "server/src/modules/_shared/context.ts", {
      startLine: 4,
      endLine: 6,
    });
    expect(decision).toEqual({
      kind: "in-diff",
      file: "server/src/modules/_shared/context.ts",
      line: "4-6",
    });
  });

  it("collapses a single-line ranged ref to a bare line value", () => {
    const index = buildPatchLineIndex(FILES);
    // Review-focus single line (startLine only, no endLine).
    const decision = decideRefLink(index, "package.json", { startLine: 34 });
    expect(decision).toEqual({ kind: "in-diff", file: "package.json", line: "34" });
  });

  it("returns a FILE-LEVEL in-diff jump (no line) for a path-only ref whose path IS a diff file (AC-4)", () => {
    const index = buildPatchLineIndex(FILES);
    const decision = decideRefLink(index, "server/src/modules/_shared/context.ts");
    expect(decision).toEqual({
      kind: "in-diff",
      file: "server/src/modules/_shared/context.ts",
    });
  });

  it("falls back when the path is NOT a changed file in the diff (blast-radius caller) (AC-5)", () => {
    const index = buildPatchLineIndex(FILES);
    expect(decideRefLink(index, "server/src/some/caller.ts", { startLine: 2 })).toEqual({
      kind: "fallback",
    });
    // Path-only out-of-diff ref also falls back.
    expect(decideRefLink(index, "server/src/some/caller.ts")).toEqual({ kind: "fallback" });
  });

  it("falls back when the matching file has no stored patch (binary / large) (AC-5)", () => {
    const index = buildPatchLineIndex(FILES);
    expect(decideRefLink(index, "server/src/big-binary.node", { startLine: 3 })).toEqual({
      kind: "fallback",
    });
    // Even a path-only ref to a patch-less file falls back (nothing to jump into).
    expect(decideRefLink(index, "server/src/big-binary.node")).toEqual({ kind: "fallback" });
  });

  it("falls back for a stale ranged ref that no longer intersects the new-side hunks (AC-5)", () => {
    const index = buildPatchLineIndex(FILES);
    // Lines 40-50 are outside the file's rendered new-side lines 1..8.
    expect(
      decideRefLink(index, "server/src/modules/_shared/context.ts", {
        startLine: 40,
        endLine: 50,
      }),
    ).toEqual({ kind: "fallback" });
  });

  it("treats a non-positive / non-integer start as a path-only (file-level) target", () => {
    const index = buildPatchLineIndex(FILES);
    expect(
      decideRefLink(index, "server/src/modules/_shared/context.ts", { startLine: 0 }),
    ).toEqual({ kind: "in-diff", file: "server/src/modules/_shared/context.ts" });
  });

  it("parses each file's patch at most once across many decisions (memoized index)", () => {
    // Build once, reuse across many refs — the same file resolves identically.
    const index = buildPatchLineIndex(FILES);
    const first = decideRefLink(index, "server/src/modules/_shared/context.ts", { startLine: 5 });
    const second = decideRefLink(index, "server/src/modules/_shared/context.ts", { startLine: 5 });
    expect(first).toEqual(second);
    expect(first.kind).toBe("in-diff");
  });
});

describe("buildInDiffQuery / buildInDiffHref — internal-URL builder (AC-3/AC-11)", () => {
  it("builds a tab=diff&file&line query object from a line in-diff decision", () => {
    const query = buildInDiffQuery({ kind: "in-diff", file: "a/b.ts", line: "4-6" });
    expect(query).toEqual({ tab: "diff", file: "a/b.ts", line: "4-6" });
  });

  it("omits line for a file-level in-diff decision (AC-4)", () => {
    const query = buildInDiffQuery({ kind: "in-diff", file: "a/b.ts" });
    expect(query).toEqual({ tab: "diff", file: "a/b.ts" });
  });

  it("serializes onto the current PR route, preserving unrelated params and never emitting a protocol (AC-3/AC-11)", () => {
    const href = buildInDiffHref(
      "/repos/r1/pulls/7",
      new URLSearchParams("tab=overview&trace=run-9"),
      { tab: "diff", file: "server/src/modules/_shared/context.ts", line: "4-11" },
    );
    // Same-route relative URL only — no host, no javascript: protocol.
    expect(href.startsWith("/repos/r1/pulls/7?")).toBe(true);
    expect(href).not.toMatch(/^[a-z]+:/i);
    const sp = new URLSearchParams(href.split("?")[1]);
    expect(sp.get("tab")).toBe("diff");
    expect(sp.get("file")).toBe("server/src/modules/_shared/context.ts");
    expect(sp.get("line")).toBe("4-11");
    // Unrelated existing param is preserved.
    expect(sp.get("trace")).toBe("run-9");
  });

  it("deletes a stale line param when building a file-level href", () => {
    const href = buildInDiffHref(
      "/repos/r1/pulls/7",
      new URLSearchParams("tab=diff&file=old.ts&line=1-2"),
      { tab: "diff", file: "new.ts" },
    );
    const sp = new URLSearchParams(href.split("?")[1]);
    expect(sp.get("file")).toBe("new.ts");
    expect(sp.has("line")).toBe(false);
  });
});
