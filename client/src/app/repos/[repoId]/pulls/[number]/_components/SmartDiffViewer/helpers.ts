/* helpers.ts — pure three-source join for the Smart Diff viewer.

   Smart Diff (the contract) carries the role grouping, ordering, finding_lines
   and pseudocode_summary, but NO patch text and NO per-finding severity. So the
   viewer joins three already-fetched sources, matched by `path`:
     1. SmartDiffResponse.groups  → role grouping, ordering, finding_lines, summary
     2. PrFile[] (usePullDetail)  → the `patch` text for parsePatch rendering
     3. ReviewRecord[] (usePrReviews) → the latest kind:'review' review's
        non-dismissed findings → per-line severity + per-file severity tally.

   Severity lives ONLY in source 3 (finding_lines have none). All functions here
   are pure so they can be memoized in the component and unit-reasoned about. */
import type {
  FindingRecord,
  PrFile,
  ReviewRecord,
  SmartDiffResponse,
} from "@devdigest/shared";
import type { Severity } from "@devdigest/ui";

type SmartDiffRole = SmartDiffResponse["groups"][number]["role"];
type SmartDiffFile = SmartDiffResponse["groups"][number]["files"][number];

/** Fixed display order — business logic first, generated last. */
export const ROLE_ORDER: readonly SmartDiffRole[] = ["core", "wiring", "boilerplate"];

/** Roles whose group renders expanded by default; boilerplate stays collapsed. */
export const DEFAULT_OPEN_ROLES: ReadonlySet<SmartDiffRole> = new Set<SmartDiffRole>([
  "core",
  "wiring",
]);

/** A per-file severity tally for the "N findings" badge. */
export type SeverityTally = Record<Severity, number>;

/** One file in a joined group: SmartDiff metadata + its patch + severity overlay. */
export interface JoinedFile {
  role: SmartDiffRole;
  path: string;
  additions: number;
  deletions: number;
  pseudocode_summary: string | null | undefined;
  finding_lines: number[];
  /** Unified-diff patch text; null when binary / not fetched. */
  patch: string | null;
  /** Highest severity flagged on each finding line (for the line tint). */
  severityByLine: Map<number, Severity>;
  /** Count of non-dismissed findings on this file, by severity (for the badge). */
  severityTally: SeverityTally;
  /**
   * The non-dismissed findings (latest review) on this file, so the badge can
   * open a popover that lists their full content (title, rationale, file:line).
   */
  findings: FindingRecord[];
}

/** A joined group ready to render: role + its files (already in SmartDiff order). */
export interface JoinedGroup {
  role: SmartDiffRole;
  files: JoinedFile[];
}

/** Severity ranking so the line tint reflects the worst finding on that line. */
const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 4,
  WARNING: 3,
  SUGGESTION: 2,
  INFO: 1,
};

function emptyTally(): SeverityTally {
  return { CRITICAL: 0, WARNING: 0, SUGGESTION: 0, INFO: 0 };
}

/**
 * A finding's lines/tags are valid only when its DERIVED `anchor_status` is
 * `current` (Stage 2 / L1). Missing ⇒ treat as `current` (legacy / fast-path).
 * `moved_out`/`orphaned` findings must NOT tint lines, show inline tags, or count
 * in the per-file severity overlay — they are surfaced in the dedicated
 * "Outdated findings" section instead (see `collectOutdatedFindings`).
 */
export function isCurrentAnchor(finding: FindingRecord): boolean {
  return finding.anchor_status == null || finding.anchor_status === "current";
}

/**
 * From all reviews, pick the latest `kind:'review'` review and build, per file
 * path, the non-dismissed findings' line→severity map plus a severity tally.
 * `usePrReviews` returns reviews newest-first, so the first match is the latest.
 */
type SeverityOverlayEntry = {
  severityByLine: Map<number, Severity>;
  tally: SeverityTally;
  count: number;
  findings: FindingRecord[];
};

export function buildSeverityOverlay(
  reviews: ReviewRecord[] | undefined,
): Map<string, SeverityOverlayEntry> {
  const overlay = new Map<string, SeverityOverlayEntry>();
  const latest = reviews?.find((r) => r.kind === "review");
  if (!latest) return overlay;

  for (const finding of latest.findings) {
    if (finding.dismissed_at != null) continue;
    // Skip stale-anchor findings: they must not tint/count on the current diff.
    if (!isCurrentAnchor(finding)) continue;
    const severity = finding.severity as Severity;

    let entry = overlay.get(finding.file);
    if (!entry) {
      entry = { severityByLine: new Map(), tally: emptyTally(), count: 0, findings: [] };
      overlay.set(finding.file, entry);
    }

    entry.tally[severity] += 1;
    entry.count += 1;
    entry.findings.push(finding);

    // Tag every line in the inclusive [start_line..end_line] range with the
    // worst severity seen on that line (finding ranges may overlap).
    const start = finding.start_line;
    const end = finding.end_line >= finding.start_line ? finding.end_line : finding.start_line;
    for (let line = start; line <= end; line++) {
      const current = entry.severityByLine.get(line);
      if (current == null || SEVERITY_RANK[severity] > SEVERITY_RANK[current]) {
        entry.severityByLine.set(line, severity);
      }
    }
  }
  return overlay;
}

/**
 * Join the three sources into render-ready groups, in fixed role order. Files in
 * a SmartDiff group but absent from `files` (binary / no patch) still appear with
 * a null patch — parsePatch(null) === [], so the body renders empty.
 */
export function joinSmartDiff(
  smartDiff: SmartDiffResponse | null | undefined,
  files: PrFile[] | undefined,
  reviews: ReviewRecord[] | undefined,
): JoinedGroup[] {
  if (!smartDiff || smartDiff.groups.length === 0) return [];

  // `additions`/`deletions` AND `patch` must come from ONE source (PrFile, the
  // fresh `getDetail` payload) so the +/- badge and the rendered patch never
  // disagree — even on the first load after a new commit, before the separately
  // fetched smart-diff (saved pr_files) catches up. SmartDiff stays the source of
  // roles / order / finding_lines / pseudocode_summary only. Fall back to the
  // smart-diff counts when a path is absent from PrFile (binary / not fetched).
  const metaByPath = new Map<
    string,
    { patch: string | null; additions: number; deletions: number }
  >();
  for (const f of files ?? [])
    metaByPath.set(f.path, {
      patch: f.patch ?? null,
      additions: f.additions,
      deletions: f.deletions,
    });

  const overlay = buildSeverityOverlay(reviews);

  const groups: JoinedGroup[] = [];
  for (const role of ROLE_ORDER) {
    const group = smartDiff.groups.find((g) => g.role === role);
    if (!group || group.files.length === 0) continue;

    const joinedFiles = group.files.map((file: SmartDiffFile): JoinedFile => {
      const sev = overlay.get(file.path);
      const meta = metaByPath.get(file.path);
      return {
        role,
        path: file.path,
        additions: meta?.additions ?? file.additions,
        deletions: meta?.deletions ?? file.deletions,
        pseudocode_summary: file.pseudocode_summary,
        finding_lines: file.finding_lines,
        patch: meta?.patch ?? null,
        severityByLine: sev?.severityByLine ?? new Map(),
        severityTally: sev?.tally ?? emptyTally(),
        findings: sev?.findings ?? [],
      };
    });

    groups.push({ role, files: joinedFiles });
  }
  return groups;
}

/** Stable DOM id for a finding-line jump target, keyed by file path + line no. */
export function jumpTargetId(path: string, lineNo: number): string {
  return `smartdiff-${path}:${lineNo}`;
}

/**
 * Per-file map of `start_line → worst severity` for the inline per-line tags.
 *
 * Unlike `severityByLine` (which tints the whole [start..end] range), the inline
 * tag is placed ONCE per finding, on its `start_line`. When two findings share a
 * start line, the worst severity wins (same SEVERITY_RANK ordering as the tint).
 * Pure so the component can memoize it.
 */
export function tagSeverityByLine(findings: FindingRecord[]): Map<number, Severity> {
  const byLine = new Map<number, Severity>();
  for (const finding of findings) {
    if (finding.dismissed_at != null) continue;
    if (!isCurrentAnchor(finding)) continue;
    const severity = finding.severity as Severity;
    const line = finding.start_line;
    const current = byLine.get(line);
    if (current == null || SEVERITY_RANK[severity] > SEVERITY_RANK[current]) {
      byLine.set(line, severity);
    }
  }
  return byLine;
}

/**
 * Per-file map of `start_line → non-dismissed findings starting on that line`.
 *
 * Drives the clickable inline tag (R3): a click on a line's tag opens the shared
 * findings popover scoped to exactly that line's finding(s) — `get(lineNo) ?? []`
 * — i.e. "its specific finding" for the common 1-per-line case. Insertion order is
 * preserved so the popover lists findings as they were reported. Pure so the
 * component can memoize it.
 */
export function findingsByStartLine(findings: FindingRecord[]): Map<number, FindingRecord[]> {
  const byLine = new Map<number, FindingRecord[]>();
  for (const finding of findings) {
    if (finding.dismissed_at != null) continue;
    if (!isCurrentAnchor(finding)) continue;
    const line = finding.start_line;
    const existing = byLine.get(line);
    if (existing) existing.push(finding);
    else byLine.set(line, [finding]);
  }
  return byLine;
}

/** One file's bucket of stale-anchor findings for the "Outdated findings" section. */
export interface OutdatedFindingGroup {
  path: string;
  findings: FindingRecord[];
}

/**
 * Collect the latest review's non-dismissed stale-anchor findings — `moved_out`,
 * `orphaned`, and `content_changed` (anything not `current`),
 * grouped by file path (insertion order preserved), for the PR-level "Outdated
 * findings" section. These are the findings the smart-diff overlay deliberately
 * does NOT tint/tag (so they don't silently vanish or mis-anchor). Mirrors
 * `buildSeverityOverlay` (latest `kind:'review'`, newest-first) so both views
 * read the same review. Pure so the component can memoize it.
 */
export function collectOutdatedFindings(
  reviews: ReviewRecord[] | undefined,
): OutdatedFindingGroup[] {
  const latest = reviews?.find((r) => r.kind === "review");
  if (!latest) return [];

  const byPath = new Map<string, FindingRecord[]>();
  for (const finding of latest.findings) {
    if (finding.dismissed_at != null) continue;
    if (isCurrentAnchor(finding)) continue; // keep moved_out / orphaned / content_changed
    const list = byPath.get(finding.file);
    if (list) list.push(finding);
    else byPath.set(finding.file, [finding]);
  }

  return Array.from(byPath, ([path, findings]) => ({ path, findings }));
}
