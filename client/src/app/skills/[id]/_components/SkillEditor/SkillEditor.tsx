/* SkillEditor — Config / Preview / Versions for a skill. Tab routing lives in
   ?tab= (the page owns it). Mirrors AgentEditor. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Tabs } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { ConfigTab } from "./_components/ConfigTab";
import { PreviewTab } from "./_components/PreviewTab";
import { VersionsTab } from "./_components/VersionsTab";
import { TABS } from "./constants";
import { s } from "./styles";

export function SkillEditor({
  skill,
  tab,
  onTab,
}: {
  skill: Skill;
  tab: string;
  onTab: (t: string) => void;
}) {
  const t = useTranslations("skills");
  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));
  return (
    <div style={s.wrap}>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={onTab} pad="0 24px" />
      </div>
      <div style={s.body}>
        {/* key={skill.id}: remount on skill switch so tabs re-seed their state. */}
        {tab === "preview" && <PreviewTab key={`p-${skill.id}`} skill={skill} />}
        {tab === "versions" && <VersionsTab key={`v-${skill.id}`} skill={skill} />}
        {tab === "config" && <ConfigTab key={`c-${skill.id}`} skill={skill} />}
      </div>
    </div>
  );
}
