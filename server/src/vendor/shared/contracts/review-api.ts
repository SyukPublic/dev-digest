import { z } from 'zod';
import { Finding, Verdict } from './findings.js';
import { BlastRadius, Intent, Risks, SmartDiff } from './brief.js';

/**
 * A2 — Review-Core API surface contracts. These extend the core
 * Review/Finding/Intent/SmartDiff contracts with the persisted/transport shapes
 * the reviewer endpoints return. A2 owns this file; the barrel re-exports it.
 *
 * Distinct from `Finding` (the raw LLM-output unit): `FindingRecord` adds the
 * persisted row identity + action timestamps so the UI can render accept/dismiss
 * state and the `review_id` it belongs to.
 *
 * `anchor_status` is a DERIVED freshness verdict (computed on read against the
 * CURRENT diff, never stored, never emitted by the LLM): `moved_out` = the
 * finding's lines no longer intersect a hunk, `orphaned` = its file left the
 * diff, `content_changed` = the lines are still present but their content
 * changed (sha mismatch vs the snapshot the review ran against — L2-lite).
 * Optional so older callers/tests stay valid and the client treats missing
 * as `current`.
 */

export const FindingRecord = Finding.extend({
  review_id: z.string(),
  accepted_at: z.string().nullable(),
  dismissed_at: z.string().nullable(),
  anchor_status: z.enum(['current', 'moved_out', 'orphaned', 'content_changed']).optional(),
});
export type FindingRecord = z.infer<typeof FindingRecord>;

/** A persisted review with its kept findings + grounding summary. */
export const ReviewRecord = z.object({
  id: z.string(),
  pr_id: z.string(),
  agent_id: z.string().nullable(),
  run_id: z.string().nullable(),
  agent_name: z.string().nullish(),
  kind: z.enum(['summary', 'review']),
  verdict: Verdict.nullable(),
  summary: z.string().nullable(),
  score: z.number().int().nullable(),
  model: z.string().nullable(),
  grounding: z.string().nullish(),
  created_at: z.string(),
  findings: z.array(FindingRecord),
});
export type ReviewRecord = z.infer<typeof ReviewRecord>;

/**
 * Response of `POST /pulls/:id/review`. Each requested agent produces a run that
 * streams over SSE at `/runs/:runId/events`; clients subscribe per run. The
 * persisted reviews are also returned once the (synchronous) run completes.
 */
export const ReviewRunTarget = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
});
export type ReviewRunTarget = z.infer<typeof ReviewRunTarget>;

export const ReviewRunResponse = z.object({
  pr_id: z.string(),
  runs: z.array(ReviewRunTarget),
  reviews: z.array(ReviewRecord),
});
export type ReviewRunResponse = z.infer<typeof ReviewRunResponse>;

/**
 * Intent persisted for a PR (the Intent plus the pr_id it scopes).
 *
 * `is_stale` is a DERIVED freshness hint (stored key vs freshly-computed key);
 * optional so older callers/tests stay valid and the client treats missing as
 * not-stale. `stale_reason` is reserved for a future per-input reason and is not
 * computed in Stage 1.
 */
export const PrIntentRecord = Intent.extend({
  pr_id: z.string(),
  is_stale: z.boolean().optional(),
  stale_reason: z.string().optional(),
});
export type PrIntentRecord = z.infer<typeof PrIntentRecord>;

/**
 * Risks persisted for a PR (the Risks plus the pr_id it scopes).
 *
 * `is_stale` / `stale_reason` mirror `PrIntentRecord` — optional derived
 * freshness hints; missing means not-stale.
 */
export const PrRisksRecord = Risks.extend({
  pr_id: z.string(),
  is_stale: z.boolean().optional(),
  stale_reason: z.string().optional(),
});
export type PrRisksRecord = z.infer<typeof PrRisksRecord>;

/** Smart-diff response for a PR (the SmartDiff). */
export const SmartDiffResponse = SmartDiff;
export type SmartDiffResponse = z.infer<typeof SmartDiffResponse>;

/**
 * Blast-radius response for a PR (the deterministic impact map plus the index
 * `status` that drives the partial/degraded badge).
 *
 * Unlike `PrIntentRecord`/`PrRisksRecord`, this is NOT a flat `.extend()` of the
 * persisted record — `BlastRadius` (`./brief.js`) carries no index state, so the
 * envelope wraps it explicitly and adds `status` + an optional `degraded_reason`.
 *
 * `status` is a LOCAL enum mirroring the repo-intel module's `IndexStatus` TS
 * union (`modules/repo-intel/types.ts`): that union is server-module-internal,
 * not a shared contract, so it is declared here rather than imported.
 */
export const BlastResponse = z.object({
  pr_id: z.string(),
  blast: BlastRadius,
  status: z.enum(['full', 'partial', 'degraded', 'failed']),
  degraded_reason: z.string().nullish(),
});
export type BlastResponse = z.infer<typeof BlastResponse>;
