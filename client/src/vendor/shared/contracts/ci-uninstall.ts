import { z } from 'zod';

/**
 * Multi-agent CI — uninstall ("Remove from CI") response contract.
 *
 * EXTENDS the barrel with a NEW file (never edits an existing one). Returned by
 * `DELETE /agents/:id/ci-installations/:installationId`: it confirms the studio
 * row deletion AND the branch-cleanup outcome so the client can surface a clear
 * result without a second round-trip. Shape is fixed by the spec (SPEC-2026-07-16
 * "Uninstall result"); the `CiInstallation` DTO stays frozen — `manifest_slug`
 * remains an internal repository column, never exposed here.
 */
export const CiUninstallResult = z.object({
  /** The `ci_installations` row was deleted (AC-70). */
  removed: z.boolean(),
  /** "owner/name" of the repo the agent was removed from. */
  repo: z.string(),
  /** The agent whose installation was removed. */
  agent_id: z.string(),
  /**
   * The `devdigest/ci` branch was updated with a commit deleting that agent's
   * manifest/skills (and, when last, the workflow/runner) — AC-71/AC-72.
   */
  branch_updated: z.boolean(),
  /** The reused export PR's URL, if one is open on `devdigest/ci` (else null). */
  pr_url: z.string().nullable(),
  /** This was the LAST installed agent on the repo → workflow/runner also removed (AC-72). */
  last_agent_removed: z.boolean(),
});
export type CiUninstallResult = z.infer<typeof CiUninstallResult>;
