"use client";

import React from "react";
import { useTranslations, useFormatter } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { CiRunSummary } from "@devdigest/shared";
import { RunCostBadge } from "@/components/run-cost-badge";
import { ciStatusBadge } from "../helpers";
import { s } from "../styles";

/**
 * CI run history for the agent — the agent's `source='ci'` runs. Reuses the
 * shared `RunCostBadge` (the "—, never $0.00" rule lives there) and renders a
 * compact per-run row rather than deep-importing the PR-route `RunHistory`
 * (which would be a cross-feature import).
 */
export function CiRunHistory({ runs, emptyText }: { runs: CiRunSummary[]; emptyText: string }) {
  const t = useTranslations("ci");
  const format = useFormatter();
  const now = Date.now();

  if (runs.length === 0) {
    return <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "4px 2px" }}>{emptyText}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {runs.map((r) => {
        const badge = ciStatusBadge(r);
        return (
          <div key={r.run_id} style={s.installRow}>
            {badge && (
              <Badge dot color={badge.color}>
                {t(`runs.status.${badge.labelKey}`)}
              </Badge>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{r.agent_name ?? "Agent"}</span>
              <span className="mono" style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                {r.repo ?? "—"}
                {r.pr_number != null ? ` · #${r.pr_number}` : ""}
              </span>
            </div>
            <div style={s.rowMeta}>
              <span>{t("runs.table.findings")}: {r.findings_count ?? 0}</span>
              <RunCostBadge costUsd={r.cost_usd} tokensIn={r.tokens_in} tokensOut={r.tokens_out} />
              {r.ran_at && <span>{format.relativeTime(new Date(r.ran_at), now)}</span>}
              {r.github_url && (
                <a href={r.github_url} target="_blank" rel="noreferrer" style={{ color: "var(--accent-text)", textDecoration: "none" }}>
                  {t("runs.table.trace")}
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
