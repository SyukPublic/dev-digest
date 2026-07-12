import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `skills` namespace. */
export interface SkillEditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Skill editor tabs: edit config, preview as the agent sees it, differential
 *  evals (delta on a host agent), body history. */
export const TABS: readonly SkillEditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "context", labelKey: "editor.tabs.context", icon: "FileText" },
  { key: "preview", labelKey: "editor.tabs.preview", icon: "Eye" },
  { key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" },
  { key: "versions", labelKey: "editor.tabs.versions", icon: "History" },
];
