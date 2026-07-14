/* One row of the CI Runs table: Timestamp, PR link, Agent, Source, Duration,
   Findings (severity badges), Cost, Status, and a per-row Trace link opening
   the GitHub Actions run. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { CiRunSummary } from "@devdigest/shared";
import { RunCostBadge } from "@/components/run-cost-badge";
import { SeverityCountBadges } from "@/components/findings/SeverityCountBadges";
import { CiRunStatusBadge } from "./CiRunStatusBadge";
import { findingCountsOf, formatDuration, formatTimestamp, prUrl, statusOf } from "./helpers";
import { s } from "./styles";

export function CiRunRow({ run }: { run: CiRunSummary }) {
  const t = useTranslations("ci");
  const counts = findingCountsOf(run);
  const pr = prUrl(run.repo, run.pr_number);

  return (
    <div style={s.row} role="row">
      {/* TIMESTAMP */}
      <span style={{ ...s.cell, ...s.ts }} role="cell">
        {formatTimestamp(run.ran_at)}
      </span>

      {/* PULL REQUEST — "#123" links to the PR, title is best-effort */}
      <span style={s.cell} role="cell">
        {run.pr_number != null ? (
          pr ? (
            <a href={pr} target="_blank" rel="noopener noreferrer" style={s.prLink}>
              #{run.pr_number}
            </a>
          ) : (
            <span style={s.prLink}>#{run.pr_number}</span>
          )
        ) : (
          <span style={s.muted}>—</span>
        )}
      </span>

      {/* AGENT */}
      <span style={{ ...s.cell, ...s.agentCell }} role="cell">
        <Icon.Cpu size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <span style={s.agentName}>{run.agent_name ?? t("runs.table.agent")}</span>
      </span>

      {/* SOURCE — every CI run currently comes via GitHub Actions */}
      <span style={s.cell} role="cell">
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          {t("exportWizard.targets.gha")}
        </span>
      </span>

      {/* DURATION */}
      <span style={{ ...s.cell, ...s.ts }} role="cell">
        {formatDuration(run.duration_ms)}
      </span>

      {/* FINDINGS */}
      <span style={s.findingsCell} role="cell">
        {counts ? <SeverityCountBadges counts={counts} /> : <span style={s.muted}>—</span>}
      </span>

      {/* COST */}
      <span style={s.cell} role="cell">
        <RunCostBadge costUsd={run.cost_usd} />
      </span>

      {/* STATUS */}
      <span style={s.cell} role="cell">
        <CiRunStatusBadge status={statusOf(run)} />
      </span>

      {/* TRACE — opens the GitHub Actions job */}
      <span role="cell" style={{ justifySelf: "end" }}>
        {run.github_url ? (
          <a href={run.github_url} target="_blank" rel="noopener noreferrer" style={s.traceLink}>
            <Icon.ExternalLink size={12} />
            {t("runs.table.trace")}
          </a>
        ) : (
          <span style={s.muted}>—</span>
        )}
      </span>
    </div>
  );
}
