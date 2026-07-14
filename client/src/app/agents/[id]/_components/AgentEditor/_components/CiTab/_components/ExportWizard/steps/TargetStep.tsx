"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FormField, TextInput, Badge, Icon } from "@devdigest/ui";
import type { CiTarget } from "@devdigest/shared";
import { WIZARD_TARGETS } from "../constants";
import { s } from "../styles";

/** Step 1 — pick the CI target + target repo. Only GitHub Actions is selectable. */
export function TargetStep({
  repo,
  onRepo,
  target,
  onTarget,
}: {
  repo: string;
  onRepo: (v: string) => void;
  target: CiTarget;
  onTarget: (t: CiTarget) => void;
}) {
  const t = useTranslations("ci");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <FormField label={t("exportWizard.repoLabel")} hint={t("exportWizard.repoHint")} required>
        <TextInput value={repo} onChange={onRepo} placeholder={t("exportWizard.repoPlaceholder")} />
      </FormField>

      <div style={s.cardGrid}>
        {WIZARD_TARGETS.map((tg) => {
          const I = Icon[tg.icon];
          const selected = tg.enabled && target === tg.key;
          return (
            <button
              key={tg.key}
              type="button"
              disabled={!tg.enabled}
              aria-pressed={selected}
              onClick={() => tg.enabled && onTarget(tg.key)}
              style={s.targetCard({ selected, enabled: tg.enabled })}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <I size={16} style={{ color: selected ? "var(--accent)" : "var(--text-secondary)" }} />
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" }}>
                  {t(`exportWizard.targets.${tg.key}`)}
                </span>
                {tg.recommended && (
                  <Badge color="var(--accent-text)" bg="var(--accent-bg)">
                    {t("exportWizard.recommended")}
                  </Badge>
                )}
              </div>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {t(`exportWizard.targets.${tg.key}Desc`)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
