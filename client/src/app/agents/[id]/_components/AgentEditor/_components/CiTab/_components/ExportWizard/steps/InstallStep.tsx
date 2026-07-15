"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import { s } from "../styles";

type InstallAction = "open_pr" | "files";

const OPTIONS: readonly InstallAction[] = ["open_pr", "files"];

/**
 * Step 4 — choose how to install, as a keyboard-operable radiogroup (AC-53).
 * The recommended card opens a PR (checked by default); the second card is the
 * copy-a-zip path. The actual action fires from the wizard footer's "Install"
 * button, driven by the selected card. A success PR link appears once installed.
 */
export function InstallStep({
  repo,
  fileCount,
  installing,
  prUrl,
  installAction,
  onInstallAction,
}: {
  repo: string;
  fileCount: number;
  installing: boolean;
  prUrl: string | null;
  installAction: InstallAction;
  onInstallAction: (a: InstallAction) => void;
}) {
  const t = useTranslations("ci");
  const [focused, setFocused] = React.useState<InstallAction | null>(null);
  const refs = React.useRef<Record<InstallAction, HTMLButtonElement | null>>({ open_pr: null, files: null });

  const move = (dir: 1 | -1) => {
    const i = OPTIONS.indexOf(installAction);
    const next = OPTIONS[(i + dir + OPTIONS.length) % OPTIONS.length]!;
    onInstallAction(next);
    refs.current[next]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      move(-1);
    }
  };

  const cardStyle = (value: InstallAction): React.CSSProperties => {
    const checked = installAction === value;
    return {
      ...s.installCard(checked),
      width: "100%",
      textAlign: "left",
      cursor: "pointer",
      // Visible focus ring for keyboard navigation (AC-53).
      outline: focused === value ? "2px solid var(--accent)" : "none",
      outlineOffset: 2,
    };
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div role="radiogroup" aria-label={t("exportWizard.steps.install")} style={{ display: "flex", flexDirection: "column", gap: 12 }} onKeyDown={onKeyDown}>
        <button
          ref={(el) => { refs.current.open_pr = el; }}
          type="button"
          role="radio"
          aria-checked={installAction === "open_pr"}
          tabIndex={installAction === "open_pr" ? 0 : -1}
          onClick={() => onInstallAction("open_pr")}
          onFocus={() => setFocused("open_pr")}
          onBlur={() => setFocused(null)}
          style={cardStyle("open_pr")}
        >
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
        </button>

        <button
          ref={(el) => { refs.current.files = el; }}
          type="button"
          role="radio"
          aria-checked={installAction === "files"}
          tabIndex={installAction === "files" ? 0 : -1}
          onClick={() => onInstallAction("files")}
          onFocus={() => setFocused("files")}
          onBlur={() => setFocused(null)}
          style={cardStyle("files")}
        >
          <Icon.Copy size={18} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{t("exportWizard.zipCardTitle")}</span>
          </div>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("exportWizard.zipCardHint")}</span>
        </button>
      </div>

      <a
        href="https://docs.github.com/actions"
        target="_blank"
        rel="noreferrer"
        style={{ fontSize: 13, color: "var(--accent-text)", textDecoration: "none" }}
      >
        {t("exportWizard.docsLink")}
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
