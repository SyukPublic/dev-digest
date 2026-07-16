/* Colored status badge for one CI run (Succeeded / No findings / Failed /
   Running). Color + icon carry meaning alongside the label (never color-alone). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, type IconName } from "@devdigest/ui";
import type { CiRunStatus } from "./constants";

const STATUS_STYLE: Record<CiRunStatus, { color: string; bg: string; icon: IconName }> = {
  succeeded: { color: "var(--warn)", bg: "var(--warn-bg)", icon: "MessageSquare" },
  noFindings: { color: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle" },
  failed: { color: "var(--crit)", bg: "var(--crit-bg)", icon: "XCircle" },
  running: { color: "var(--accent)", bg: "var(--accent-bg)", icon: "RefreshCw" },
};

export function CiRunStatusBadge({ status }: { status: CiRunStatus }) {
  const t = useTranslations("ci");
  const st = STATUS_STYLE[status];
  return (
    <Badge color={st.color} bg={st.bg} icon={st.icon}>
      {t(`runs.status.${status}`)}
    </Badge>
  );
}
