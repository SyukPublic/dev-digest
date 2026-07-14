"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import { CI_TAB_COPY } from "../constants";
import { s } from "../styles";

/**
 * Step 4 — choose how to install. The recommended card opens a PR (the actual
 * install fires from the wizard footer's "Install" button); the second card is
 * the degraded copy-a-zip path. A success PR link appears once installed.
 */
export function InstallStep({
  repo,
  fileCount,
  installing,
  prUrl,
}: {
  repo: string;
  fileCount: number;
  installing: boolean;
  prUrl: string | null;
}) {
  const t = useTranslations("ci");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={s.installCard(true)}>
        <Icon.GitPullRequest size={18} style={{ color: "var(--accent)", flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{t("exportWizard.installCardTitle")}</span>
            <Badge color="var(--accent-text)" bg="var(--accent-bg)">
              {t("exportWizard.recommended")}
            </Badge>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 3, lineHeight: 1.5 }}>
            {t("exportWizard.installCardBody", { repo: repo || t("exportWizard.ownerRepo"), count: fileCount })}
          </div>
        </div>
      </div>

      <div style={s.installCard(false)}>
        <Icon.Copy size={18} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{CI_TAB_COPY.zipCardTitle}</span>
        </div>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{CI_TAB_COPY.zipCardHint}</span>
      </div>

      <a
        href="https://docs.github.com/actions"
        target="_blank"
        rel="noreferrer"
        style={{ fontSize: 13, color: "var(--accent-text)", textDecoration: "none" }}
      >
        {CI_TAB_COPY.docsLink}
      </a>

      {installing && (
        <div role="status" aria-live="polite" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)" }}>
          <Icon.RefreshCw size={14} className="dd-spin" />
          {t("exportWizard.installing")}
        </div>
      )}

      {prUrl && (
        <a
          href={prUrl}
          target="_blank"
          rel="noreferrer"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--accent-text)", textDecoration: "none" }}
        >
          <Icon.ExternalLink size={13} />
          {t("publishDialog.openPr")}
        </a>
      )}
    </div>
  );
}
