import type { Finding, UnifiedDiff } from '@devdigest/shared';

/**
 * Citation grounding — the mandatory mechanical gate for diff-findings.
 *
 * A diff-finding is kept ONLY if its [start_line, end_line] range intersects a
 * real hunk in the unified diff for the same file. Findings that fail are
 * dropped (the model "hallucinated" a location).
 *
 * EXCEPTION: findings from full-file scanners (hooks / blast / onboarding) are
 * not tied to a diff hunk — they ground against the file existing in the diff
 * (or are exempted entirely). We treat `kind` in {secret_leak, lethal_trifecta,
 * phantom, hook} as full-file: they only require the file to be present.
 */

const FULL_FILE_KINDS = new Set(['secret_leak', 'lethal_trifecta', 'phantom', 'hook']);

export interface GroundingResult {
  kept: Finding[];
  dropped: { finding: Finding; reason: string }[];
}

/** Build a quick lookup of file → set of new-side line numbers covered by hunks. */
export function buildLineIndex(diff: UnifiedDiff): Map<string, Set<number>> {
  const idx = new Map<string, Set<number>>();
  for (const f of diff.files) {
    const set = new Set<number>();
    for (const h of f.hunks) {
      if (h.newLineNumbers && h.newLineNumbers.length > 0) {
        for (const n of h.newLineNumbers) set.add(n);
      } else {
        // fall back to the hunk's declared new range
        for (let n = h.newStart; n < h.newStart + Math.max(h.newLines, 1); n++) set.add(n);
      }
    }
    idx.set(f.path, set);
  }
  return idx;
}

function rangeIntersects(lines: Set<number>, start: number, end: number): boolean {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  for (let n = lo; n <= hi; n++) if (lines.has(n)) return true;
  return false;
}

/**
 * Apply the grounding gate to a set of findings against a unified diff.
 * Returns the kept findings and the dropped ones with reasons (for the trace).
 */
export function groundFindings(findings: Finding[], diff: UnifiedDiff): GroundingResult {
  const lineIndex = buildLineIndex(diff);
  const filesInDiff = new Set(diff.files.map((f) => f.path));
  const kept: Finding[] = [];
  const dropped: { finding: Finding; reason: string }[] = [];

  for (const finding of findings) {
    const isFullFile = finding.kind ? FULL_FILE_KINDS.has(finding.kind) : false;

    if (!filesInDiff.has(finding.file)) {
      dropped.push({ finding, reason: `file '${finding.file}' not present in diff` });
      continue;
    }

    if (isFullFile) {
      // full-file scanners only need the file to be in the diff
      kept.push(finding);
      continue;
    }

    const lines = lineIndex.get(finding.file) ?? new Set<number>();
    if (rangeIntersects(lines, finding.start_line, finding.end_line)) {
      kept.push(finding);
    } else {
      dropped.push({
        finding,
        reason: `lines ${finding.start_line}-${finding.end_line} do not intersect any diff hunk in '${finding.file}'`,
      });
    }
  }

  return { kept, dropped };
}

/**
 * `content_changed` (L2-lite) is set by the SERVER on READ: the anchor lines
 * are still present (`anchorStatus` → `current`) but their CONTENT differs from
 * what the review ran against (a sha256 of the normalized `anchoredText`
 * mismatches the stored fingerprint). `anchorStatus` itself never returns it —
 * it is content-blind by design (L1).
 */
export type AnchorStatus = 'current' | 'moved_out' | 'orphaned' | 'content_changed';

/**
 * Per-finding anchor status against a CURRENT diff — the grounding predicate
 * reused for staleness. PURE: knows only finding + diff (the head_sha fast-path
 * / legacy-NULL handling is the SERVER's job, not this function).
 *  - file absent from diff        → 'orphaned'
 *  - full-file kind, file present → 'current' (no line anchor)
 *  - finding range hits a hunk    → 'current', else 'moved_out'
 *
 * It NEVER returns `content_changed` — that is a content comparison the SERVER
 * layers on top (it owns the sha256 fingerprint; this function is content-blind).
 */
export function anchorStatus(finding: Finding, diff: UnifiedDiff): AnchorStatus {
  const filesInDiff = new Set(diff.files.map((f) => f.path));
  if (!filesInDiff.has(finding.file)) return 'orphaned';
  const isFullFile = finding.kind ? FULL_FILE_KINDS.has(finding.kind) : false;
  if (isFullFile) return 'current';
  const lines = buildLineIndex(diff).get(finding.file) ?? new Set<number>();
  return rangeIntersects(lines, finding.start_line, finding.end_line) ? 'current' : 'moved_out';
}

/**
 * Extract the normalized NEW-side text the finding anchors to, for content-aware
 * staleness (L2-lite). Collects every new-side line whose number is in the
 * finding's `[min(start,end)..max]` range across all hunks of the finding's
 * file, in ascending line-number order, each right-trimmed (trailing whitespace
 * only — indentation preserved), joined with `\n`.
 *
 * PURE — the diff is an INPUT; NO crypto/db/network. The server hashes the
 * returned string (the SAME way on write and read) to detect content drift.
 *
 * Returns `null` when no text is available — either the file is absent, the
 * range covers no parsed line, OR the diff predates `newLineText` / its length
 * does not line up with `newLineNumbers` (safe legacy fallback: the caller then
 * stores/compares no fingerprint, so the finding stays `current`).
 */
export function anchoredText(finding: Finding, diff: UnifiedDiff): string | null {
  const file = diff.files.find((f) => f.path === finding.file);
  if (!file) return null;

  // newLineNumber → raw text, gathered from every hunk that has aligned text.
  const byLine = new Map<number, string>();
  for (const h of file.hunks) {
    const nums = h.newLineNumbers;
    const text = h.newLineText;
    // Require aligned text for THIS hunk; a mismatch/absence makes it unusable.
    if (!text || text.length !== nums.length) return null;
    for (let i = 0; i < nums.length; i++) byLine.set(nums[i]!, text[i]!);
  }

  const lo = Math.min(finding.start_line, finding.end_line);
  const hi = Math.max(finding.start_line, finding.end_line);
  const picked: string[] = [];
  // Ascending line-number order; only lines actually present in the diff.
  for (const n of [...byLine.keys()].sort((a, b) => a - b)) {
    if (n < lo || n > hi) continue;
    picked.push(byLine.get(n)!.replace(/\s+$/, ''));
  }
  if (picked.length === 0) return null;
  return picked.join('\n');
}

/** Human-readable summary, e.g. "3/3 passed" used in run-trace stats. */
export function groundingSummary(result: GroundingResult): string {
  const total = result.kept.length + result.dropped.length;
  return `${result.kept.length}/${total} passed`;
}
