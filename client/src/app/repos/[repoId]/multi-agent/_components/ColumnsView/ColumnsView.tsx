/* ColumnsView — the default results layout: one column per agent. Each column
   header shows status / score / cost, the body lists that agent's findings, and
   the footer links to the run trace. Live status flips via the parent's
   useMultiAgentRun poll; we also subscribe to the running runs' SSE (useRunEvents,
   content-addressed by runIds.join(",") — see client INSIGHTS 2026-06-22) and
   announce status through an aria-live region. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { CircularScore, Icon, MonoLink, SEV, type Severity } from "@devdigest/ui";
import type { AgentColumn, MultiAgentRun } from "@devdigest/shared";
import { useRunEvents } from "@/lib/hooks/reviews";
import { RunCostBadge } from "@/components/run-cost-badge";
import { scoreColor } from "../../helpers";
import { s } from "./styles";

function StatusPill({ status }: { status: AgentColumn["status"] }) {
  const t = useTranslations("runs");
  if (status === "running") {
    return (
      <span style={s.status("var(--accent-text)")}>
        <Icon.RefreshCw size={12} className="dd-spin" />
        {t("column.running")}
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span style={s.status("var(--crit)")}>
        <Icon.X size={12} />
        {t("column.failed")}
      </span>
    );
  }
  return (
    <span style={s.status("var(--ok)")}>
      <Icon.Check size={12} />
      {t("column.done")}
    </span>
  );
}

function AgentColumnCard({
  col,
  onOpenTrace,
}: {
  col: AgentColumn;
  onOpenTrace: (col: AgentColumn) => void;
}) {
  const t = useTranslations("runs");
  return (
    <div style={s.column(scoreColor(col.score))}>
      <div style={s.colHead}>
        <div style={s.colTitleRow}>
          <Icon.Users size={15} style={{ color: "var(--text-muted)" }} />
          <span style={s.colName}>{col.agent_name}</span>
          {col.score != null && <CircularScore score={col.score} size={38} />}
        </div>
        <div style={s.colMeta}>
          {/* aria-live: SPA status changes are silent otherwise (AC a11y). */}
          <span aria-live="polite">
            <StatusPill status={col.status} />
          </span>
          <RunCostBadge costUsd={col.cost_usd} />
        </div>
      </div>

      <div style={s.findings}>
        {col.findings.length === 0 ? (
          <div style={s.empty}>{t("column.noFindings")}</div>
        ) : (
          col.findings.map((f) => {
            const sev = SEV[f.severity as Severity];
            const I = Icon[sev.icon];
            return (
              <div key={f.id} style={s.finding}>
                <I size={14} style={{ color: sev.c, flexShrink: 0, marginTop: 2 }} />
                <div style={s.findingBody}>
                  <div style={s.findingTitle}>{f.title}</div>
                  <span className="mono" style={s.findingLoc}>
                    {f.file}:{f.start_line}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div style={s.colFoot}>
        <MonoLink onClick={() => onOpenTrace(col)}>{t("viewTrace")}</MonoLink>
        <span style={s.count}>{t("column.findingsCount", { count: col.findings.length })}</span>
      </div>
    </div>
  );
}

export function ColumnsView({
  run,
  onOpenTrace,
}: {
  run: MultiAgentRun;
  onOpenTrace: (col: AgentColumn) => void;
}) {
  // Keep the SSE streams for still-running agents live. A fresh array each render
  // is intentional — useRunEvents is content-addressed by runIds.join(",").
  const runningRunIds = run.columns.filter((c) => c.status === "running").map((c) => c.run_id);
  useRunEvents(runningRunIds);

  return (
    <div style={s.row}>
      {run.columns.map((col) => (
        <AgentColumnCard key={col.run_id} col={col} onOpenTrace={onOpenTrace} />
      ))}
    </div>
  );
}
