"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Markdown, Badge } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { isUntrustedSource } from "@/lib/skills";

/** Preview tab — the skill body rendered "as the reviewing agent receives it". */
export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const untrusted = isUntrustedSource(skill.source);
  return (
    <div style={{ maxWidth: 820 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>{t("editor.tabs.preview")}</h2>
        {untrusted && <Badge color="var(--warn)">{t("preview.untrustedBadge")}</Badge>}
      </div>
      {untrusted && (
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 14, lineHeight: 1.5 }}>
          {t("preview.untrustedNotice")}
        </p>
      )}
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: 20,
          background: "var(--bg-surface)",
          fontSize: 14,
        }}
      >
        <Markdown>{skill.body}</Markdown>
      </div>
    </div>
  );
}
