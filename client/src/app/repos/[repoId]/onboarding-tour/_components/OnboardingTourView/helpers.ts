/* helpers.ts — project-specific glue for the Onboarding Tour view: the fixed
   seven-section order + per-section icon/colour/anchor, a relative "X ago"
   formatter for the meta line, and the repo file-viewer deep-link. Pure
   functions only (no side effects) so they stay trivially testable. */
import type { IconName } from "@devdigest/ui";
import { githubBlobUrl } from "@/lib/github-urls";

/** A section's presentation config. `kind` matches `OnboardingSection.kind`;
 *  `titleKey`/`anchor` reference i18n + the in-page TOC anchor id. */
export interface SectionConfig {
  kind: string;
  /** i18n key under the "onboarding" namespace (Phase 7 fills the value). */
  titleKey: string;
  /** Stable in-page anchor id (used by OnThisPage + the card wrapper). */
  anchor: string;
  icon: IconName;
  /** Accent colour for the card's round icon container. */
  color: string;
}

/**
 * The seven sections in FIXED display order (AC-1, AC-12). The stored tour's
 * sections are matched to this order by `kind`; unknown kinds fall through to
 * the end so the model can never reorder the page (AC-3 is enforced per-section
 * for `reading_path`, but the top-level card order is deterministic here).
 */
export const SECTION_ORDER: readonly SectionConfig[] = [
  { kind: "overview", titleKey: "sections.overview", anchor: "overview", icon: "Sparkles", color: "var(--accent-text)" },
  { kind: "architecture", titleKey: "sections.architecture", anchor: "architecture", icon: "Layers", color: "#60a5fa" },
  { kind: "key_modules", titleKey: "sections.key_modules", anchor: "key-modules", icon: "Boxes", color: "#34d399" },
  { kind: "reading_path", titleKey: "sections.reading_path", anchor: "reading-path", icon: "ListChecks", color: "#60a5fa" },
  { kind: "getting_started", titleKey: "sections.getting_started", anchor: "getting-started", icon: "Play", color: "#fbbf24" },
  { kind: "conventions_gotchas", titleKey: "sections.conventions_gotchas", anchor: "conventions-gotchas", icon: "AlertTriangle", color: "#fbbf24" },
  { kind: "first_tasks", titleKey: "sections.first_tasks", anchor: "first-tasks", icon: "Target", color: "#34d399" },
] as const;

/** Max links surfaced in the `first_tasks` card (design brief: "up to ~4"). */
export const FIRST_TASKS_MAX_LINKS = 4;

/**
 * A compact "X ago" string from an ISO timestamp, or null when absent/unparseable.
 * Intl.RelativeTimeFormat keeps it locale-aware without a date library; `now` is
 * injectable for deterministic tests.
 */
export function relativeTimeAgo(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const diffSec = Math.round((then - now) / 1000); // negative → in the past
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(Math.round(diffSec), "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 2592000) return rtf.format(Math.round(diffSec / 86400), "day");
  if (abs < 31536000) return rtf.format(Math.round(diffSec / 2592000), "month");
  return rtf.format(Math.round(diffSec / 31536000), "year");
}

/**
 * Deep-link to a repo file in the existing file viewer (github.com blob at the
 * repo's default branch). Reuses `githubBlobUrl` (the house pattern used by the
 * PR blast/diff cards) — no new viewer is invented (AC-17). Returns undefined
 * when the repo identity isn't known yet, so the Open control falls back to text.
 */
export function fileViewerHref(
  repoFullName: string | null | undefined,
  ref: string | null | undefined,
  path: string,
): string | undefined {
  return repoFullName && ref ? githubBlobUrl(repoFullName, ref, path) : undefined;
}

/** Matches the START of a top-level numbered-list line: optional leading
 *  whitespace, one-or-more digits, a dot, then at least one space. Anchored and
 *  bounded (no nested quantifiers over the same class) so it cannot backtrack
 *  catastrophically — the body is already-stored, schema-validated content, but
 *  we keep the regex ReDoS-safe on principle (R1b, AC-21, OWASP A05). */
const NUMBERED_LINE = /^\s*\d+\.\s+/;

/** Strips a leading "N." (+ following spaces) from a single line, e.g.
 *  "1. Foundation…" → "Foundation…". Used both by the parser (to keep the item
 *  TEXT, dropping the marker we already re-number) and by the label sanitizer. */
function stripLeadingNumberPrefix(line: string): string {
  return line.replace(NUMBERED_LINE, "").replace(/^\d+\.\s*/, "");
}

/**
 * Extract a top-level numbered list from a model-authored markdown `body`
 * (R1b, AC-19/AC-21). Line-level, bounded parse: a line matching `^\s*\d+\.\s+`
 * opens a new item; every following non-numbered line is FOLDED (joined with a
 * space) into the current item until the next numbered line — so a multi-line
 * description collapses to ONE inline string (required because the shared
 * `<Markdown>` styles only INLINE elements; client INSIGHTS 2026-06-23). The
 * item's own "N." marker is stripped (the caller re-numbers by index). Returns
 * `[]` when the body has no clean top-level numbered list (empty / prose only /
 * malformed), letting the caller detect a mismatch or parse failure and fall
 * back (AC-20). Never throws.
 */
export function parseNumberedList(body: string | null | undefined): string[] {
  if (!body) return [];
  const items: string[] = [];
  // Blank lines end the current item's continuation but don't start a new one.
  let current: string | null = null;
  let sawBlank = false;
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trimEnd();
    if (NUMBERED_LINE.test(line)) {
      if (current !== null) items.push(current.trim());
      current = stripLeadingNumberPrefix(line);
      sawBlank = false;
      continue;
    }
    if (current === null) continue; // preamble before the first numbered line
    if (line.trim().length === 0) {
      sawBlank = true; // remember, but keep folding a later continuation line
      continue;
    }
    // Fold a continuation line into the current item as inline text.
    current += (sawBlank ? " " : " ") + line.trim();
    sawBlank = false;
  }
  if (current !== null) items.push(current.trim());
  return items.filter((it) => it.length > 0);
}

/**
 * Sanitize an `OnboardingLink.label` for use as the FALLBACK reading-path
 * description (R1b, AC-20) when no usable body list is available. Strips a
 * leading duplicate "N." number prefix (old-prompt tours store labels like
 * "1. _shared.ts", and the renderer already numbers by index — leaving it would
 * double the number), then returns the label ONLY when it is non-empty AND not
 * equal to the path's filename (a filename-equal label carries no description).
 * Otherwise returns `null` to signal "render the path alone". Pure; never throws.
 */
export function sanitizeReadingPathLabel(
  label: string | null | undefined,
  path: string,
): string | null {
  if (!label) return null;
  const cleaned = stripLeadingNumberPrefix(label.trim()).trim();
  if (cleaned.length === 0) return null;
  const filename = path.split("/").pop() ?? path;
  if (cleaned === filename || cleaned === path) return null;
  return cleaned;
}
