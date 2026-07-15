"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { FormField, Badge, Icon, Dropdown, type DropdownItemDef } from "@devdigest/ui";
import type { CiTarget } from "@devdigest/shared";
import { useActiveRepo } from "@/lib/repo-context";
import { useRepos } from "@/lib/hooks/core";
import { WIZARD_TARGETS } from "../constants";
import { s } from "../styles";

/**
 * Step 1 — pick the CI target + target repo. Only GitHub Actions is selectable.
 * The repo is chosen from a selector modelled on the nav switcher (Dropdown +
 * repo items + an "Add repository…" entry that routes to /onboarding), NOT a
 * free-text field and with NO trash/remove affordance (AC-52).
 */
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
  const router = useRouter();
  const { repos: ctxRepos } = useActiveRepo();
  const { data: fetched } = useRepos();
  const repos = ctxRepos.length ? ctxRepos : fetched ?? [];

  const items: DropdownItemDef[] = [
    // Repo rows — no onRemove, so no trash affordance is rendered (AC-52).
    ...repos.map((r) => ({
      label: r.full_name,
      icon: "GitBranch" as const,
      onClick: () => onRepo(r.full_name),
    })),
    ...(repos.length ? [{ divider: true }] : []),
    // "Add repository…" reuses the nav-switcher behaviour: route to /onboarding.
    { label: t("exportWizard.addRepo"), icon: "Plus", muted: true, onClick: () => router.push("/onboarding") },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <FormField label={t("exportWizard.repoLabel")} hint={t("exportWizard.repoHint")} required>
        <Dropdown
          align="left"
          width={340}
          items={items}
          trigger={
            <button type="button" aria-label={t("exportWizard.repoLabel")} style={s.repoSelectTrigger}>
              <Icon.GitBranch size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <span
                className="mono"
                style={{ flex: 1, textAlign: "left", color: repo ? "var(--text-primary)" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {repo || t("exportWizard.repoSelect")}
              </span>
              <Icon.ChevronsUpDown size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            </button>
          }
        />
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
