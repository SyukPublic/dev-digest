import type { SkillSource, SkillType } from "@devdigest/shared";

/** All skill types in display order, for select inputs (labels resolved via i18n
 *  listItem.type.*). Drift-proof against the `SkillType` Zod enum via
 *  `satisfies Record<SkillType, true>` (a new/renamed member fails typecheck) at
 *  ZERO runtime cost — we deliberately keep the value-side out: a value-import of
 *  the schema (`SkillType.options`) would pull zod into the client bundle, which
 *  the client otherwise avoids (it imports `@devdigest/shared` contracts type-only). */
const SKILL_TYPES = { rubric: true, convention: true, security: true, custom: true } satisfies Record<SkillType, true>;
export const SKILL_TYPE_VALUES = Object.keys(SKILL_TYPES) as readonly SkillType[];

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
