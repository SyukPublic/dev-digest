/* StatsTab (Agent Editor) — per-agent quality + cost + usage over a period
   (AC-5/6/7/8/9/18/22–27/35/36). Composes the reused chart primitives +
   PeriodControl + loading/empty/error states. Memory/skill/category names render
   as escaped text (default JSX escaping); never dangerouslySetInnerHTML. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  BarRow,
  CircularScore,
  EmptyState,
  ErrorState,
  MetricCard,
  Skeleton,
} from "@devdigest/ui";
import type { Agent, SeverityWeek } from "@devdigest/shared";
import RunTraceDrawer from "@/components/run-trace";
import { PeriodControl } from "@/components/period-control";
import { AcceptRateCard, CategoryDonut } from "@/components/stats";
import { SEVERITY_COLORS } from "@/components/stats/colors";
import { useAgentStats } from "@/lib/hooks/stats";
import { formatCost } from "@/lib/format";
import { DEFAULT_PERIOD, periodLabel, type StatsPeriod } from "@/lib/period";
import { RunHistoryTable } from "./RunHistoryTable";
import { s } from "./styles";

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}

/** A labeled BarRow list from trace-derived shares (skills / memory). */
function ShareBars({ items, emptyLabel }: { items: { label: string; pct: number }[]; emptyLabel: string }) {
  if (items.length === 0) {
    return <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{emptyLabel}</span>;
  }
  return (
    <div>
      {items.map((it) => (
        <BarRow
          key={it.label}
          label={it.label}
          value={it.pct}
          max={1}
          suffix={`${Math.round(it.pct * 100)}%`}
        />
      ))}
    </div>
  );
}

/** Weekly stacked-severity bars, oldest→newest (AC-25). */
function WeeklySeverityBars({ weeks, label }: { weeks: SeverityWeek[]; label: string }) {
  const max = Math.max(1, ...weeks.map((w) => w.CRITICAL + w.WARNING + w.SUGGESTION));
  const summary = weeks
    .map((w) => `${w.week}: ${w.CRITICAL + w.WARNING + w.SUGGESTION}`)
    .join(", ");
  return (
    <div role="img" aria-label={`${label}: ${summary}`}>
      <div style={s.weekly}>
        {weeks.map((w) => (
          <div key={w.week} style={s.weekCol}>
            <div style={s.weekStack}>
              {(["SUGGESTION", "WARNING", "CRITICAL"] as const).map((sev) => (
                <div
                  key={sev}
                  style={{
                    height: `${(w[sev] / max) * 100}%`,
                    background: SEVERITY_COLORS[sev],
                  }}
                />
              ))}
            </div>
            <span style={s.weekLabel}>{w.week}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StatsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const [period, setPeriod] = React.useState<StatsPeriod>(DEFAULT_PERIOD);
  const [traceRunId, setTraceRunId] = React.useState<string | null>(null);
  const { data, isLoading, isError, isFetching, refetch } = useAgentStats(agent.id, period);
  const label = periodLabel(period);

  return (
    <div style={s.wrap}>
      <div aria-live="polite" role="status" style={s.srOnly}>
        {!isFetching && data ? t("stats.updated") : ""}
      </div>

      <div style={s.headerRow}>
        <div />
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
          <Skeleton height={160} />
        </div>
      )}

      {isError && <ErrorState body={t("stats.loadError")} onRetry={() => refetch()} />}

      {!isLoading && !isError && data && data.runs === 0 && (
        <EmptyState icon="BarChart" title={t("stats.empty.title")} body={t("stats.empty.body")} />
      )}

      {!isLoading && !isError && data && data.runs > 0 && (
        <>
          <div style={s.cards}>
            <MetricCard
              label={`${t("stats.cards.totalRuns")} (${label})`}
              value={data.runs}
              trend={data.trend.map((p) => p.value)}
            />
            <MetricCard
              label={`${t("stats.cards.avgCost")} (${label})`}
              value={formatCost(data.avg_cost_usd)}
              {...(data.avg_cost_delta_usd != null ? { delta: data.avg_cost_delta_usd } : {})}
            />
            <MetricCard label={t("stats.cards.avgDuration")} value={formatDuration(data.avg_latency_ms)} />
            <AcceptRateCard label={t("stats.cards.acceptRate")} rate={data.accept_rate} />
          </div>

          <div style={s.panels}>
            <div style={s.panel}>
              <div style={s.panelTitle}>{t("stats.panels.mostUsedSkills")}</div>
              <ShareBars
                items={data.most_used_skills.map((x) => ({ label: x.name, pct: x.pct }))}
                emptyLabel={t("stats.panels.noData")}
              />
            </div>
            <div style={s.panel}>
              <div style={s.panelTitle}>{t("stats.panels.mostPulledMemory")}</div>
              <ShareBars
                items={data.most_pulled_memory.map((x) => ({ label: x.label, pct: x.pct }))}
                emptyLabel={t("stats.panels.noData")}
              />
            </div>
          </div>

          <div style={s.panels}>
            <div style={s.panel}>
              <div style={s.panelTitle}>{t("stats.panels.findingsBySeverity")}</div>
              <WeeklySeverityBars
                weeks={data.findings_by_severity_weekly}
                label={t("stats.panels.findingsBySeverity")}
              />
              <div style={s.legend}>
                {(["CRITICAL", "WARNING", "SUGGESTION"] as const).map((sev) => (
                  <span key={sev} style={s.legendItem}>
                    <span style={{ ...s.legendDot, background: SEVERITY_COLORS[sev] }} />
                    {t(`stats.severity.${sev.toLowerCase()}`)}
                  </span>
                ))}
              </div>
            </div>
            <div style={s.panel}>
              <div style={s.panelTitle}>{t("stats.panels.findingsByCategory")}</div>
              <CategoryDonut
                data={data.findings_by_category}
                emptyLabel={t("stats.panels.noData")}
                ariaLabel={t("stats.panels.findingsByCategory")}
              />
            </div>
          </div>

          <RunHistoryTable rows={data.run_history} onViewTrace={setTraceRunId} />
        </>
      )}

      {traceRunId && (
        <RunTraceDrawer
          runId={traceRunId}
          agentName={agent.name}
          onClose={() => setTraceRunId(null)}
        />
      )}
    </div>
  );
}
