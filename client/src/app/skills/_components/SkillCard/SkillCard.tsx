/* SkillCard — type + source badges, enabled toggle, "needs vetting" flag for
   untrusted sources. Mirrors AgentCard. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useDeleteSkill } from "@/lib/hooks/skills";
import { isUntrustedSource, typeColor } from "./helpers";
import { s } from "./styles";

export function SkillCard({
  skill,
  active,
  onClick,
  onToggle,
}: {
  skill: Skill;
  active?: boolean;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  const del = useDeleteSkill();
  const untrusted = isUntrustedSource(skill.source);
  const needsVetting = untrusted && !skill.enabled;

  return (
    <div onClick={onClick} style={s.card(!!active, skill.enabled)}>
      <div style={s.headerRow}>
        <div style={s.iconBox}>
          <Icon.Sparkles size={15} />
        </div>
        <span style={s.name}>{skill.name}</span>
        {onToggle && (
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle on={skill.enabled} onChange={onToggle} size={14} />
          </div>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`Delete skill "${skill.name}"? This cannot be undone.`)) del.mutate(skill.id);
          }}
          disabled={del.isPending}
          title="Delete skill"
          aria-label="Delete skill"
          style={s.trashBtn(del.isPending)}
        >
          <Icon.Trash size={14} className={del.isPending ? "dd-spin" : undefined} />
        </button>
      </div>
      <div style={s.description}>{skill.description || t("listItem.type." + skill.type)}</div>
      <div style={s.metaRow}>
        <span className="mono" style={s.typeChip(typeColor(skill.type))}>
          {t("listItem.type." + skill.type)}
        </span>
        <Badge color="var(--text-secondary)">{t("listItem.source." + skill.source)}</Badge>
        {needsVetting && (
          <Badge color="var(--warn)" icon="AlertTriangle">
            {t("listItem.needsVetting")}
          </Badge>
        )}
      </div>
    </div>
  );
}
