/* refLink.ts — the pure, client-only in-diff-vs-fallback DECISION shared by the
   two brief-derived link surfaces (RISK AREAS in IntentCard and REVIEW FOCUS in
   ReviewFocusSection). One implementation, so both surfaces stay thin (they
   render; the decision is a function call).

   Given the already-fetched `pull.files` (each `PrFile.patch`) and a ref's
   `path` + optional line range / single line, it answers:
     (a) is `path` a changed file present in the PR diff WITH a stored patch?
     (b) does the ranged `start-end` / single `line` intersect that file's
         new-side (`newNo`) hunk lines?
   → `{ kind: "in-diff", file, line? }` when the target is confidently in the
     diff (a path-only / no-line ref whose path IS a diff file resolves to a
     file-level jump, no `line`); otherwise `{ kind: "fallback" }` so the caller
     keeps today's github.com blob behavior — a cascade fallback, never a dead
     link.

   SECURITY (AC-11): the ref path/range are UNTRUSTED LLM-derived text. The
   internal target is ONLY the app's own PR route with `tab`/`file`/`line` query
   keys — never an href protocol; range/line are parsed to positive integers and
   validated against the diff before use. `parsePatch` is memoized per path so
   rendering many refs never re-parses the same patch (Performance NFR). */
import type { PrFile } from "@devdigest/shared";
import { parsePatch, type Line } from "@/components/diff-viewer/helpers";

/** The Files-changed tab's query value (see page.tsx `tab === "diff"`). */
export const DIFF_TAB = "diff";

/** A ref's line target: an optional inclusive `[startLine, endLine]` range (from a
    ranged `file_refs` entry) OR a single `line` (from a `review_focus[].line`).
    All fields already parsed to positive integers by the caller's parser; a
    path-only / no-line ref passes neither. */
export interface RefLineTarget {
  startLine?: number;
  endLine?: number;
}

/** The decision outcome: an internal in-diff jump target, or the github.com
    fallback. `file`/`line` are meaningful ONLY together with `tab=diff`. */
export type RefLinkDecision =
  | { kind: "in-diff"; file: string; line?: string }
  | { kind: "fallback" };

/** A memoizer for `parsePatch` keyed by file path — build ONE per render pass
    (`buildPatchLineIndex(files)`) and reuse it across every ref decision so a
    file's patch is parsed at most once (Performance NFR). Returns the parsed
    lines for a path, or `null` when the path is absent / has no stored patch. */
export type PatchLineIndex = (path: string) => Line[] | null;

/** Build a `PatchLineIndex` from the PR's files. A file present but with no
    stored `patch` (binary / large) maps to `null` — it cannot be an in-diff
    target (AC-5). `parsePatch` runs lazily and is cached per path. */
export function buildPatchLineIndex(files: PrFile[] | undefined): PatchLineIndex {
  const patchByPath = new Map<string, string | null>();
  for (const f of files ?? []) patchByPath.set(f.path, f.patch ?? null);

  const cache = new Map<string, Line[] | null>();
  return (path: string): Line[] | null => {
    if (cache.has(path)) return cache.get(path)!;
    // A path absent from the diff has no entry at all — distinct from a present
    // patch-less file (both yield `null`, both fall back, per AC-5).
    if (!patchByPath.has(path)) {
      cache.set(path, null);
      return null;
    }
    const patch = patchByPath.get(path) ?? null;
    const lines = patch != null ? parsePatch(patch) : null;
    cache.set(path, lines);
    return lines;
  };
}

/** The set of new-side (`newNo`) line numbers actually RENDERED for a file's
    parsed patch — the lines an in-diff jump can land on. Pure. */
function newSideLineSet(lines: Line[]): Set<number> {
  const set = new Set<number>();
  for (const ln of lines) if (ln.newNo != null) set.add(ln.newNo);
  return set;
}

/** True when the ref's line target intersects the file's rendered new-side hunk
    lines. A path-only / no-line target (no `startLine`) never reaches here. The
    inclusive `[start..end]` range intersects when ANY new-side line falls inside
    it. Bounds are clamped so a huge or reversed range can't loop unbounded. */
function rangeIntersectsNewSide(
  newSide: Set<number>,
  startLine: number,
  endLine: number,
): boolean {
  const lo = Math.min(startLine, endLine);
  const hi = Math.max(startLine, endLine);
  // Iterate the (smaller) rendered set, not the range, so an untrusted enormous
  // range can never drive an unbounded loop.
  for (const n of newSide) if (n >= lo && n <= hi) return true;
  return false;
}

/**
 * Decide whether a ref links INTO the in-app diff or falls back to github.com.
 *
 * - Path not a changed file with a stored patch → `{ kind: "fallback" }` (AC-5).
 * - Path IS a diff file, ref carries NO line → `{ kind: "in-diff", file }`
 *   (file-level jump, AC-4).
 * - Path IS a diff file, ref carries a range/line that intersects the new-side
 *   hunk lines → `{ kind: "in-diff", file, line }` (AC-1/AC-2), where `line` is
 *   the `start-end` (or single `line`) query value.
 * - Path IS a diff file but the range/line does NOT intersect (stale brief) →
 *   `{ kind: "fallback" }` (AC-5).
 */
export function decideRefLink(
  index: PatchLineIndex,
  path: string,
  target?: RefLineTarget,
): RefLinkDecision {
  const lines = index(path);
  if (lines == null) return { kind: "fallback" };

  const start = target?.startLine;
  // No line info → a file-level in-diff jump (open the file, no line scroll).
  if (start == null || !Number.isInteger(start) || start <= 0) {
    return { kind: "in-diff", file: path };
  }

  const endRaw = target?.endLine;
  const end = Number.isInteger(endRaw) && (endRaw as number) > 0 ? (endRaw as number) : start;

  const newSide = newSideLineSet(lines);
  if (!rangeIntersectsNewSide(newSide, start, end)) return { kind: "fallback" };

  // `line` query value: a single line collapses to `start`; a real range keeps
  // `start-end` (matching the github fallback / SmartDiffViewer semantics).
  const line = end !== start ? `${start}-${end}` : `${start}`;
  return { kind: "in-diff", file: path, line };
}

/** The extended PR-route query params for an in-diff jump. `file`/`line` are
    meaningful ONLY with `tab=diff` (invariant, spec Contracts). */
export interface InDiffQuery {
  tab: typeof DIFF_TAB;
  file: string;
  line?: string;
}

/**
 * Build the internal PR-route query object from an `in-diff` decision:
 * `{ tab: "diff", file, line? }` (`line` omitted for a file-level jump). This
 * targets ONLY the app's own PR route with the `tab`/`file`/`line` query keys —
 * it never emits an executable protocol; the range/line are already validated
 * positive integers from `decideRefLink` (AC-3, AC-11). Callers turn this into
 * an `href`/router push against the current PR route.
 */
export function buildInDiffQuery(decision: {
  kind: "in-diff";
  file: string;
  line?: string;
}): InDiffQuery {
  return decision.line != null
    ? { tab: DIFF_TAB, file: decision.file, line: decision.line }
    : { tab: DIFF_TAB, file: decision.file };
}

/**
 * Serialize an `InDiffQuery` onto the current PR-route path, preserving any
 * unrelated existing query params (e.g. an open trace) and REPLACING the
 * `tab`/`file`/`line` keys. `line` is deleted when absent (file-level jump).
 * The result is a same-route relative URL (`/repos/…/pulls/…?…`) — never an
 * absolute or protocol-bearing URL (AC-11).
 */
export function buildInDiffHref(
  basePath: string,
  existing: URLSearchParams,
  query: InDiffQuery,
): string {
  const sp = new URLSearchParams(existing.toString());
  sp.set("tab", query.tab);
  sp.set("file", query.file);
  if (query.line != null) sp.set("line", query.line);
  else sp.delete("line");
  const qs = sp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
