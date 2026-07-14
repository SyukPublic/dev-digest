"use client";

import React from "react";
import { useTranslations, useFormatter } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { CiInstallation, CiRunSummary } from "@devdigest/shared";
import { WORKFLOW_VERSION } from "../constants";
import { ciStatusBadge, latestRunFor } from "../helpers";
import { s } from "../styles";

/** Per-repo installation rows + a dashed "Add repository" row that opens the wizard. */
export function Installations({
  installations,
  runs,
  onAdd,
}: {
  installations: CiInstallation[];
  runs: CiRunSummary[];
  onAdd: () => void;
}) {
  const t = useTranslations("ci");
  const tc = useTranslations("common");
  const format = useFormatter();
  const now = Date.now();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {installations.map((inst) => {
        const run = latestRunFor(runs, inst.id);
        const badge = ciStatusBadge(run);
        return (
          <div key={inst.id} style={s.installRow}>
            <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
              {inst.repo}
            </span>
            <Badge color="var(--text-secondary)">{t("exportWizard.targets.gha")}</Badge>
            <div style={s.rowMeta}>
              {badge && (
                <Badge dot color={badge.color}>
                  {t(`runs.status.${badge.labelKey}`)}
                </Badge>
              )}
              {run?.ran_at && <span>{format.relativeTime(new Date(run.ran_at), now)}</span>}
              <span className="mono">{WORKFLOW_VERSION}</span>
            </div>
          </div>
        );
      })}
      <button type="button" style={s.addRow} onClick={onAdd}>
        + {tc("repoNotFound.cta")}
      </button>
    </div>
  );
}
