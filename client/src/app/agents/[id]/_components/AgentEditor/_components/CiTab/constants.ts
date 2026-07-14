import type { CiFailOn, CiTarget } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

/**
 * CI gate policy values. Declared LOCALLY (not imported from ConfigTab) — they
 * are a fixed enum, and a cross-`_components` import would trip the
 * `import/no-restricted-paths` lint. Both the Config tab and this tab WRITE the
 * same `ci_fail_on` field via `useUpdateAgent`; they need not share the const.
 */
export const CI_FAIL_ON_VALUES: readonly CiFailOn[] = ["never", "critical", "warning", "any"];

/** Export targets shown in the wizard's Step-1 grid. Only `gha` is selectable. */
export interface WizardTarget {
  key: CiTarget;
  icon: IconName;
  enabled: boolean;
  recommended?: boolean;
}
export const WIZARD_TARGETS: readonly WizardTarget[] = [
  { key: "gha", icon: "Workflow", enabled: true, recommended: true },
  { key: "circle", icon: "Boxes", enabled: false },
  { key: "jenkins", icon: "Wrench", enabled: false },
  { key: "cli", icon: "Code", enabled: false },
];

/** The four wizard steps, 0-based; labels resolve under `ci.exportWizard.steps`. */
export const WIZARD_STEP_KEYS = ["target", "preview", "configure", "install"] as const;

/** PR trigger events (technical GitHub identifiers, not translatable prose). */
export const TRIGGER_EVENTS = ["opened", "synchronize", "reopened"] as const;
export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];

/** Triggers on by default (reopened defaults off, per the design). */
export const DEFAULT_TRIGGERS: Record<TriggerEvent, boolean> = {
  opened: true,
  synchronize: true,
  reopened: false,
};

/** "Post results as" options; `github_review` is recommended + default. */
export const POST_AS_VALUES = ["github_review", "pr_comment", "none"] as const;
export type PostAsValue = (typeof POST_AS_VALUES)[number];

/**
 * Derived/constant workflow version shown on installation rows (R4/A6): there is
 * no per-installation version column, so the generated workflow's version is a
 * constant here.
 */
export const WORKFLOW_VERSION = "v1";

/**
 * UI copy the `ci.json` namespace does not yet define (owned by the barrier
 * phase). Kept centralized here so it is trivial to migrate to i18n keys later.
 * Everything else on this surface uses `useTranslations`.
 */
export const CI_TAB_COPY = {
  activeInRepos: (n: number) => `Active in ${n} ${n === 1 ? "repo" : "repos"}`,
  runHistory: "CI run history",
  zipCardTitle: "Copy files as a zip",
  zipCardHint: "add them manually",
  docsLink: "GitHub Action setup docs →",
} as const;
