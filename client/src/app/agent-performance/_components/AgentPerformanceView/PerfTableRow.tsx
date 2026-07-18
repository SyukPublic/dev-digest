/* PerfTableRow — one agent row in the dashboard table (AC-13/15/16). Clicking
   anywhere on the row — the caret OR the agent name — toggles the row-expand
   sparkline + caption; ONLY the "View" action navigates to that agent's Stats
   tab (it stops propagation so it doesn't also toggle). The accept cell carries
   an up/down direction indicator from the period-over-period delta. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Sparkline } from "@devdigest/ui";
import type { AgentPerfRow } from "@devdigest/shared";
import { formatCost, formatAcceptRate } from "@/lib/format";
import { s } from "./styles";

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatLastRun(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export function PerfTableRow({
  row,
  expanded,
  onToggle,
  onView,
}: {
  row: AgentPerfRow;
  expanded: boolean;
  onToggle: () => void;
  onView: () => void;
}) {
  const t = useTranslations("agentPerformance");
  const delta = row.accept_rate_delta;
  const Caret = expanded ? Icon.ChevronDown : Icon.ChevronRight;

  return (
    <>
      <div style={{ ...s.row, cursor: "pointer" }} role="row" onClick={onToggle}>
        <span role="cell" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            style={s.caret}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            aria-label={t("table.expand")}
            aria-expanded={expanded}
          >
            <Caret size={14} />
          </button>
          <button
            type="button"
            style={s.nameBtn}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            {row.agent_name}
          </button>
        </span>
        <span role="cell" className="tnum">
          {row.runs}
        </span>
        <span role="cell" className="tnum">
          {formatCost(row.avg_cost_usd)}
        </span>
        <span role="cell" className="tnum">
          {formatDuration(row.avg_latency_ms)}
        </span>
        <span role="cell" style={s.acceptCell} className="tnum">
          {formatAcceptRate(row.accept_rate)}
          {delta != null && delta !== 0 && (
            <span aria-hidden style={{ color: delta > 0 ? "var(--ok)" : "var(--crit)" }}>
              {delta > 0 ? <Icon.ArrowUp size={12} /> : <Icon.ArrowDown size={12} />}
            </span>
          )}
        </span>
        <span role="cell" style={s.muted}>
          {formatLastRun(row.last_run_at)}
        </span>
        <button
          type="button"
          style={s.viewBtn}
          onClick={(e) => {
            e.stopPropagation();
            onView();
          }}
        >
          {t("table.view")}
        </button>
      </div>

      {expanded && (
        <div style={s.expandRow} role="row">
          <Sparkline data={row.trend.length ? row.trend : [0]} w={120} h={28} />
          <span style={s.expandCaption}>
            {t("rowExpand", {
              count: row.trend.length,
              duration: formatDuration(row.avg_latency_ms),
              cost: formatCost(row.avg_cost_usd),
            })}
          </span>
        </div>
      )}
    </>
  );
}
