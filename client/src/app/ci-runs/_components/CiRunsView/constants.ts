/* Constants for the CI Runs page — the "all" filter sentinel and the display
   status vocabulary. Kept local to this feature (single consumer). */

/** Sentinel value for an "All …" filter option (no narrowing). */
export const ALL = "__all__" as const;

/** Derived, display-level run status (distinct from the raw agent_runs status). */
export type CiRunStatus = "succeeded" | "noFindings" | "failed" | "running";

/** Ordered for the status filter dropdown. */
export const CI_RUN_STATUSES: readonly CiRunStatus[] = [
  "succeeded",
  "noFindings",
  "failed",
  "running",
];
