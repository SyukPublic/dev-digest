/* AgentPerformanceView — the global Agent Performance dashboard (AC-5/6/10/11–18/36).
   Summary cards, a sortable agent table with row-expand trends, and two
   cost-breakdown donuts. Default sort: accept-rate desc (AC-14). Row / View →
   that agent's editor Stats tab (AC-15). All data via useAgentPerformance. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Donut,
  EmptyState,
  ErrorState,
  Icon,
  MetricCard,
  Skeleton,
  type DonutSegment,
} from "@devdigest/ui";
import type { AgentPerf, AgentPerfRow, PerfCostSegment } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { PeriodControl } from "@/components/period-control";
import { AcceptRateCard } from "@/components/stats";
import { paletteColor } from "@/components/stats/colors";
import { useAgentPerformance } from "@/lib/hooks/stats";
import { formatCost, formatAcceptRate } from "@/lib/format";
import { DEFAULT_PERIOD, periodLabel, type StatsPeriod } from "@/lib/period";
import { PerfTableRow } from "./PerfTableRow";
import { s } from "./styles";

type SortKey = "accept" | "runs" | "cost";

function sortRows(rows: AgentPerfRow[], key: SortKey, dir: "asc" | "desc"): AgentPerfRow[] {
  const val = (r: AgentPerfRow) =>
    key === "runs" ? r.runs : key === "cost" ? (r.avg_cost_usd ?? -1) : (r.accept_rate ?? -1);
  const sorted = [...rows].sort((a, b) => val(a) - val(b));
  return dir === "desc" ? sorted.reverse() : sorted;
}

function toSegments(cost: PerfCostSegment[]): DonutSegment[] {
  return cost.map((c, i) => ({ label: c.label, value: c.value, color: paletteColor(i) }));
}

export function AgentPerformanceView() {
  const t = useTranslations("agentPerformance");
  const router = useRouter();
  const [period, setPeriod] = React.useState<StatsPeriod>(DEFAULT_PERIOD);
  const [sortKey, setSortKey] = React.useState<SortKey>("accept");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const { data, isLoading, isError, isFetching, refetch } = useAgentPerformance(period);
  const label = periodLabel(period);

  const rows = React.useMemo(
    () => (data ? sortRows(data.agents, sortKey, sortDir) : []),
    [data, sortKey, sortDir],
  );

  const onSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const onView = (agentId: string) => router.push(`/agents/${agentId}?tab=stats`);

  const sortMark = (key: SortKey) =>
    sortKey === key ? (sortDir === "desc" ? " ↓" : " ↑") : "";

  return (
    <AppShell crumb={[{ label: t("title") }]}>
      <div aria-live="polite" role="status" style={s.srOnly}>
        {!isFetching && data ? t("updated") : ""}
      </div>

      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("title")}</h1>
            <p style={s.subtitle}>{t("subtitle")}</p>
          </div>
          <PeriodControl value={period} onChange={setPeriod} />
        </div>

        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={s.cards}>
              <Skeleton height={92} />
              <Skeleton height={92} />
              <Skeleton height={92} />
              <Skeleton height={92} />
            </div>
            <Skeleton height={200} />
          </div>
        )}

        {isError && <ErrorState body={t("loadError")} onRetry={() => refetch()} />}

        {!isLoading && !isError && data && data.summary.runs === 0 && (
          <EmptyState icon="TrendingUp" title={t("empty.title")} body={t("empty.body")} />
        )}

        {!isLoading && !isError && data && data.summary.runs > 0 && (
          <Dashboard
            data={data}
            rows={rows}
            label={label}
            expanded={expanded}
            onToggle={(id) => setExpanded((e) => (e === id ? null : id))}
            onView={onView}
            onSort={onSort}
            sortMark={sortMark}
          />
        )}
      </div>
    </AppShell>
  );
}

function Dashboard({
  data,
  rows,
  label,
  expanded,
  onToggle,
  onView,
  onSort,
  sortMark,
}: {
  data: AgentPerf;
  rows: AgentPerfRow[];
  label: string;
  expanded: string | null;
  onToggle: (id: string) => void;
  onView: (id: string) => void;
  onSort: (key: SortKey) => void;
  sortMark: (key: SortKey) => string;
}) {
  const t = useTranslations("agentPerformance");
  const mostActiveRow = data.agents.find((r) => r.agent_name === data.summary.most_active_agent);

  return (
    <>
      <div style={s.cards}>
        <MetricCard
          label={`${t("summary.totalRuns")} (${label})`}
          value={data.summary.runs}
          trend={data.summary.runs_trend}
        />
        <MetricCard
          label={`${t("summary.totalCost")} (${label})`}
          value={formatCost(data.summary.total_cost_usd)}
          {...(data.summary.total_cost_delta_usd != null
            ? { delta: data.summary.total_cost_delta_usd }
            : {})}
        />
        <AcceptRateCard label={t("summary.avgAcceptRate")} rate={data.summary.avg_accept_rate} />
        <div style={s.card}>
          <span style={s.cardLabel}>{t("summary.mostActive")}</span>
          {mostActiveRow ? (
            <>
              <div style={s.mostActiveRow}>
                <Icon.Cpu size={18} style={{ color: "var(--text-muted)" }} />
                <span style={s.mostActiveName}>{mostActiveRow.agent_name}</span>
              </div>
              <div style={s.mostActiveDetail}>
                {t("summary.mostActiveDetail", {
                  runs: mostActiveRow.runs,
                  accept: formatAcceptRate(mostActiveRow.accept_rate),
                })}
              </div>
            </>
          ) : (
            <div style={{ ...s.mostActiveRow, ...s.muted }}>—</div>
          )}
        </div>
      </div>

      <div style={s.table} role="table" aria-label={t("perAgent")}>
        <div style={s.headRow} role="row">
          <span role="columnheader">{t("table.agent")}</span>
          <span role="columnheader">
            <button type="button" style={s.sortBtn} onClick={() => onSort("runs")}>
              {t("table.runs")}
              {sortMark("runs")}
            </button>
          </span>
          <span role="columnheader">
            <button type="button" style={s.sortBtn} onClick={() => onSort("cost")}>
              {t("table.avgCost")}
              {sortMark("cost")}
            </button>
          </span>
          <span role="columnheader">{t("table.avgDuration")}</span>
          <span role="columnheader">
            <button type="button" style={s.sortBtn} onClick={() => onSort("accept")}>
              {t("table.accept")}
              {sortMark("accept")}
            </button>
          </span>
          <span role="columnheader">{t("table.lastRun")}</span>
          <span role="columnheader">{t("table.view")}</span>
        </div>
        {rows.map((row) => (
          <PerfTableRow
            key={row.agent_id}
            row={row}
            expanded={expanded === row.agent_id}
            onToggle={() => onToggle(row.agent_id)}
            onView={() => onView(row.agent_id)}
          />
        ))}
      </div>

      <div style={s.breakdown}>
        <div style={s.panel}>
          <div style={s.panelTitle}>{t("costByAgent")}</div>
          {data.cost_by_agent.length ? (
            <Donut segments={toSegments(data.cost_by_agent)} />
          ) : (
            <span style={{ ...s.muted, fontSize: 13 }}>{t("noCost")}</span>
          )}
        </div>
        <div style={s.panel}>
          <div style={s.panelTitle}>{t("costByModel")}</div>
          {data.cost_by_model.length ? (
            <Donut segments={toSegments(data.cost_by_model)} />
          ) : (
            <span style={{ ...s.muted, fontSize: 13 }}>{t("noCost")}</span>
          )}
        </div>
      </div>
    </>
  );
}
