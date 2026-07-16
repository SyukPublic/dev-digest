import { z } from 'zod';
import { RunSummary } from './trace.js';
import { CiExportInput, CiFile } from './eval-ci.js';

/**
 * Export-to-CI (L07) — DTO/request contracts that EXTEND the barrel without
 * touching the frozen `AgentManifest` / `CiExportInput` in `eval-ci.ts`.
 *
 * Why a NEW file: `AgentManifest` and `CiExportInput` are shared verbatim with
 * the agent-runner and must not change shape. The two additions below are
 * studio-side only (a read DTO + a request extension), so they live here and are
 * re-exported from the barrel with a single `export *`.
 */

/**
 * CiRunSummary — one CI review row for the CI Runs page and the agent CI tab.
 *
 * A CI run IS an `agent_runs` row with `source='ci'`, so this is `RunSummary`
 * (the shared PR-run row) plus the four CI-only columns. The `ci_runs` course
 * table is intentionally left empty — CI runs are read from `agent_runs`.
 */
export const CiRunSummary = RunSummary.extend({
  /** SUGGESTION-severity finding count (CI-only), enabling the 3-way severity
   *  badge split on the CI Runs page. CRITICAL = `blockers`, WARNING =
   *  `findings_count − blockers − suggestions`. Null for legacy CI rows. */
  suggestions: z.number().int().nullable(),
  /** 'ci' for these rows; kept on the DTO so a mixed list stays self-describing. */
  source: z.string().nullable(),
  /** "owner/name" of the repo the CI review ran in. */
  repo: z.string().nullable(),
  /** PR number the CI review ran against. */
  pr_number: z.number().int().nullable(),
  /** GitHub Actions run URL (the per-row "Trace" link + ingest idempotency key). */
  github_url: z.string().nullable(),
  /** Owning installation; null when the installation was removed. */
  ci_installation_id: z.string().nullable(),
});
export type CiRunSummary = z.infer<typeof CiRunSummary>;

/**
 * CiExportRequest — the `POST /agents/:id/export-ci` body.
 *
 * Extends `CiExportInput` with an optional `files` array so Step-2 wizard edits
 * survive to Install (AC-6): when present the server commits them verbatim
 * (after re-validating the manifest still round-trips `AgentManifest`); when
 * absent the server generates the bundle itself.
 */
export const CiExportRequest = CiExportInput.extend({
  files: CiFile.array().nullish(),
});
export type CiExportRequest = z.infer<typeof CiExportRequest>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type CiExportRequestBody = z.input<typeof CiExportRequest>;
