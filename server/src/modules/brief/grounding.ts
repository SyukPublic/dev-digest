import type { Brief, BriefInputBundle } from '@devdigest/shared';

/**
 * grounding.ts — PURE real-path drop/repair of the model's brief against the
 * REAL file set the assembler built (CP-5, AC-4/5).
 *
 * The model may cite an INVENTED path in a `risks[].file_refs` entry or a
 * `review_focus[].path`. This is both a correctness and a SAFETY control
 * (Agentic ASI09 — validate generated content before storing): a fabricated
 * path must never be persisted, so it cannot later render as a working link.
 *
 * The `realPaths` set is EVERY path present in the assembled bundle
 * (`blast_files[].path` ∪ `smart_diff_groups[].files[].path`) — the SAME set the
 * assembler produced and the prompt showed the model. Grounding runs BEFORE
 * persist, on the server, with no I/O.
 *
 * Rules (PATH + RANGE — 2026-07-06 delta, AC-22/AC-24):
 *  - `risks[].file_refs` entry `"path:range"` — split the `:range` suffix.
 *    - If the PATH portion is NOT in `realPaths` → drop the whole entry (an
 *      invented path is never persisted — AC-5, unchanged).
 *    - If the PATH is real: the ref MUST carry a valid line range that intersects
 *      the file's real changed-line set. (i) A range that intersects → kept as-is.
 *      (ii) A missing / malformed / non-intersecting range → REPAIRED to
 *      `path:start-end` using the file's changed-hunk range, so a real-path ref
 *      is NEVER persisted bare (AC-22). (iii) When the file has NO changed-hunk
 *      range (best-effort nullish — no real line data), the range is dropped and
 *      only the validated real PATH is kept (AC-24 graceful degradation).
 *    A risk whose refs ALL drop is still persisted (title/explanation/severity).
 *  - `review_focus[].path` — drop the whole item when its path ∉ `realPaths`
 *    (path-only, UNCHANGED; its `line` stays optional per the contract).
 *  - Everything else (what/why/risk_level, surviving risks/focus) is kept.
 *
 * Scope: the "make it a range" repair runs in the GENERATION path only (over a
 * freshly-modelled brief). Legacy stored briefs are read as-is (AC-3/AC-25) — no
 * read-path repair here.
 */

/** Build the real-path set from the assembled bundle (the grounding authority). */
export function realPathSet(bundle: BriefInputBundle): Set<string> {
  const paths = new Set<string>();
  for (const f of bundle.blast_files) paths.add(f.path);
  for (const g of bundle.smart_diff_groups) {
    for (const f of g.files) paths.add(f.path);
  }
  return paths;
}

/**
 * Strip the trailing `:range` (e.g. `src/config.ts:12-18` → `src/config.ts`).
 * Only a trailing `:<digits>` / `:<digits>-<digits>` line-range is stripped; a
 * `:` elsewhere in a path (rare, but valid on some filesystems) is preserved.
 */
export function pathOfRef(ref: string): string {
  return ref.replace(/:\d+(?:-\d+)?$/, '');
}

/** The trailing `:N` / `:N-M` anchor — reused by pathOfRef and rangeOfRef. */
const RANGE_SUFFIX = /:(\d+)(?:-(\d+))?$/;

/**
 * Parse the trailing `:N` / `:N-M` line range off a `file_refs` entry, or `null`
 * when the ref has no valid range suffix. `:N` ⇒ `{ start: N, end: N }`. A range
 * whose end precedes its start is normalised (start/end swapped) so intersection
 * is order-independent. Reuses the same anchor as `pathOfRef` so the path/range
 * split stays consistent (grounding recommendation 4).
 */
export function rangeOfRef(ref: string): { start: number; end: number } | null {
  const m = RANGE_SUFFIX.exec(ref);
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] !== undefined ? Number(m[2]) : start;
  if (!Number.isInteger(start) || start <= 0 || !Number.isInteger(end) || end <= 0) return null;
  return start <= end ? { start, end } : { start: end, end: start };
}

/**
 * The file's REAL changed-line SET (grounding authority, recommendation 3): the
 * UNION of that path's `changed_ranges` (expanded start..end) ∪ `caller_lines`
 * ∪ the smart-diff `finding_lines` for that path. Mirrors the findings
 * citation-grounding "must intersect a real hunk" rule. Empty when the file has
 * no real line data (best-effort nullish).
 */
export function realLineSet(bundle: BriefInputBundle, path: string): Set<number> {
  const lines = new Set<number>();
  for (const f of bundle.blast_files) {
    if (f.path !== path) continue;
    for (const r of f.changed_ranges ?? []) {
      for (let n = r.start; n <= r.end; n++) lines.add(n);
    }
    for (const n of f.caller_lines ?? []) lines.add(n);
  }
  for (const g of bundle.smart_diff_groups) {
    for (const f of g.files) {
      if (f.path !== path) continue;
      for (const n of f.finding_lines ?? []) lines.add(n);
    }
  }
  return lines;
}

/**
 * The file's changed-hunk range = the min-start / max-end over that path's
 * `changed_ranges` (the diff-derived new-side ranges — the most authoritative
 * "what actually changed"), or `null` when the file has no `changed_ranges`
 * (the repair fallback is then unavailable → the range is dropped, AC-24).
 */
export function changedHunkRange(
  bundle: BriefInputBundle,
  path: string,
): { start: number; end: number } | null {
  let start = Infinity;
  let end = -Infinity;
  for (const f of bundle.blast_files) {
    if (f.path !== path) continue;
    for (const r of f.changed_ranges ?? []) {
      if (r.start < start) start = r.start;
      if (r.end > end) end = r.end;
    }
  }
  return end >= start ? { start, end } : null;
}

/** True when `[a,b]` intersects any line in `set`. */
function rangeIntersects(range: { start: number; end: number }, set: Set<number>): boolean {
  for (let n = range.start; n <= range.end; n++) {
    if (set.has(n)) return true;
  }
  return false;
}

/**
 * Ground ONE `file_refs` entry to PATH+RANGE (AC-22/AC-24). Returns the surviving
 * ref string, or `null` to drop the whole entry (invented path). A real-path ref
 * is NEVER returned bare when a changed-hunk range exists.
 */
function groundFileRef(ref: string, bundle: BriefInputBundle, realPaths: Set<string>): string | null {
  const path = pathOfRef(ref);
  if (!realPaths.has(path)) return null; // invented path — drop whole entry (AC-5)

  const realLines = realLineSet(bundle, path);
  const range = rangeOfRef(ref);
  // (i) A valid range that intersects the real changed-line set — keep as-is.
  if (range && rangeIntersects(range, realLines)) return ref;

  // (ii) Missing / malformed / non-intersecting — repair to the changed-hunk
  //      range when the file has one, so a real-path ref is never bare (AC-22).
  const repair = changedHunkRange(bundle, path);
  if (repair) return `${path}:${repair.start}-${repair.end}`;

  // (iii) No real line data at all — drop the range, keep the validated PATH
  //       (AC-24 graceful degradation; the legacy-style bare ref).
  return path;
}

/**
 * Ground the model's brief against the bundle's real file set + line data
 * (AC-4/5, AC-22/AC-24). Returns a NEW Brief with invented `file_refs` entries
 * and `review_focus` items dropped, and each surviving real-path ref carrying a
 * validated/repaired range; the caller persists the grounded result.
 */
export function groundBrief(brief: Brief, bundle: BriefInputBundle): Brief {
  const realPaths = realPathSet(bundle);

  const risks = brief.risks.map((risk) => ({
    ...risk,
    // Drop invented-path refs; keep+ground real-path refs to path+range. A risk
    // with zero surviving refs is still persisted (title/explanation), unlinked.
    file_refs: risk.file_refs
      .map((ref) => groundFileRef(ref, bundle, realPaths))
      .filter((ref): ref is string => ref !== null),
  }));

  const review_focus = brief.review_focus.filter((item) => realPaths.has(item.path));

  return { ...brief, risks, review_focus };
}
