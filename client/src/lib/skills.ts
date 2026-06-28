import type { SkillSource, SkillType } from "@devdigest/shared";

/** All skill types, for select inputs (labels resolved via i18n listItem.type.*). */
export const SKILL_TYPE_VALUES: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

/** Chip colour per skill type (falls back to the secondary token). */
const TYPE_COLOR: Record<SkillType, string> = {
  rubric: "var(--accent)",
  convention: "var(--ok)",
  security: "var(--crit)",
  custom: "var(--text-secondary)",
};

export function typeColor(type: SkillType): string {
  return TYPE_COLOR[type] ?? "var(--text-secondary)";
}

/** Manual/extracted skills are the workspace's own (trusted); imported ones are
 *  untrusted and must be vetted before being enabled. */
export function isUntrustedSource(source: SkillSource): boolean {
  return source !== "manual" && source !== "extracted";
}
