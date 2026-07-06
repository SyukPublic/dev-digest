import { z } from 'zod';
import { Risk, RiskSeverity } from './brief.js';

/**
 * Why+Risk Brief contracts — the boundary shapes for the `POST /pulls/:id/brief`
 * producer and its cached read record. The brief FUSES already-computed artifacts
 * (Intent, blast map, smart-diff groups, linked issue, project specs) into one
 * human answer via a single structured LLM call; no diff hunks / file contents.
 *
 * `Risk` (+ the `RiskSeverity` enum `high|medium|low`) is REUSED UNCHANGED from
 * `./brief.js` — `Brief.risk_level` is the same three values, and `risks[]` is the
 * same `Risk` shape (the line-range travels inside each `file_refs` string, e.g.
 * `src/config.ts:12-18`; grounding validates only the PATH portion).
 *
 * Optional fields use `.nullish()` so absent/degraded sources parse cleanly and
 * older/legacy callers stay valid (mirrors `PrIntentRecord`, review-api.ts:76).
 */

// ---- Review focus (a genuinely NEW structured shape) ----
/**
 * One "read this first" pointer. `line` is nullish — a whole-file focus item has
 * no specific line; the client renders an in-diff jump or an out-of-diff blob link.
 */
export const ReviewFocusItem = z.object({
  path: z.string(),
  line: z.number().int().nullish(),
  reason: z.string(),
});
export type ReviewFocusItem = z.infer<typeof ReviewFocusItem>;

// ---- Brief (the single structured LLM output) ----
export const Brief = z.object({
  what: z.string(),
  why: z.string(),
  risk_level: RiskSeverity, // reused enum: 'high' | 'medium' | 'low' — no 'critical'
  risks: z.array(Risk), // Risk reused unchanged (kind/title/explanation/severity/file_refs[])
  review_focus: z.array(ReviewFocusItem), // ordered: read these first
});
export type Brief = z.infer<typeof Brief>;

// ---- Brief input bundle (the pure assembler shape; already-computed facts only) ----
/**
 * A blast file with its real callers/endpoints — the grounding source for real
 * paths (AC-4). `callers`/`endpoints` are optional (nullish) so a bare changed
 * file with no downstream still contributes its path to the real-path set.
 */
export const BriefBlastFile = z.object({
  path: z.string(),
  callers: z.array(z.string()).nullish(),
  endpoints: z.array(z.string()).nullish(),
  /**
   * The blast callers' line numbers for this file — the real line data the
   * grounding uses to validate/repair a `file_refs` range (AC-23). Nullish so a
   * file with no downstream caller (or a degraded bundle) parses cleanly. Line
   * NUMBERS only — NO diff hunks / file bodies / raw patch (AC-1).
   */
  caller_lines: z.array(z.number().int()).nullish(),
  /**
   * The file's changed-hunk NEW-SIDE line ranges, reconstructed best-effort from
   * the stored `pr_files` patches (NO network). This is the range authority for
   * grounding's "changed-hunk range" repair fallback (AC-22/AC-24). Nullish when
   * the file has no stored patch (the seed case) — `{start,end}` ranges only, NO
   * raw patch (AC-1).
   */
  changed_ranges: z
    .array(z.object({ start: z.number().int(), end: z.number().int() }))
    .nullish(),
});
export type BriefBlastFile = z.infer<typeof BriefBlastFile>;

/** A smart-diff file's per-file stats — NO patch/hunks (AC-1). */
export const BriefSmartDiffFile = z.object({
  path: z.string(),
  additions: z.number().int(),
  deletions: z.number().int(),
  finding_count: z.number().int(),
  /**
   * The file's real smart-diff finding line numbers (previously reduced to the
   * `finding_count` above — the count stays). Feeds the range grounding's
   * real-changed-line set (AC-23). Nullish so a degraded/legacy bundle parses
   * cleanly. Line NUMBERS only — NO patch/hunks (AC-1).
   */
  finding_lines: z.array(z.number().int()).nullish(),
});
export type BriefSmartDiffFile = z.infer<typeof BriefSmartDiffFile>;

/** A smart-diff group (reviewer-ordered role) with its files' stats. */
export const BriefSmartDiffGroup = z.object({
  role: z.string(),
  files: z.array(BriefSmartDiffFile),
});
export type BriefSmartDiffGroup = z.infer<typeof BriefSmartDiffGroup>;

/** A linked issue digest (best-effort; dropped on absence/error). */
export const BriefLinkedIssue = z.object({
  number: z.number().int(),
  title: z.string(),
  body: z.string().nullish(),
});
export type BriefLinkedIssue = z.infer<typeof BriefLinkedIssue>;

/** A project spec attached to an enabled reviewer agent/skill (best-effort). */
export const BriefSpec = z.object({
  path: z.string(),
  content: z.string(),
});
export type BriefSpec = z.infer<typeof BriefSpec>;

/**
 * The assembled input bundle — built best-effort from already-computed artifacts,
 * each source dropped (not thrown) on absence/error (AC-12). Contains NO diff
 * bodies / raw patch (AC-1). Everything here is framed as UNTRUSTED data at prompt
 * assembly (AC-21).
 */
export const BriefInputBundle = z.object({
  intent: z.string().nullish(),
  blast_summary: z.string().nullish(),
  blast_files: z.array(BriefBlastFile),
  smart_diff_groups: z.array(BriefSmartDiffGroup),
  linked_issue: BriefLinkedIssue.nullish(),
  specs: z.array(BriefSpec),
});
export type BriefInputBundle = z.infer<typeof BriefInputBundle>;

// ---- Stored read record (mirror PrIntentRecord, review-api.ts:76) ----
/**
 * A brief persisted for a PR (the `Brief` plus the pr_id it scopes + provenance).
 *
 * `is_stale` is a DERIVED freshness hint (stored key vs freshly-computed key),
 * recomputed on READ with NO network; optional so legacy rows with no stored key
 * (and older callers/tests) stay valid and are treated as NOT stale (AC-14).
 */
export const WhyRiskBriefRecord = Brief.extend({
  pr_id: z.string(),
  generated_at: z.string(),
  is_stale: z.boolean().optional(),
});
export type WhyRiskBriefRecord = z.infer<typeof WhyRiskBriefRecord>;
