/* StatsTab (Skill Editor) — per-skill usage + value over a period
   (AC-5/6/8/18/30/31/32/33/36). "Used by" is a config-level count (NOT
   period-scoped); pull frequency, accept-rate and findings ARE period-scoped.
   Agent names render as escaped text; the "Open" action links to that agent's
   editor. Reuses PeriodControl + the shared cards + the category donut. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Icon, MetricCard, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { PeriodControl } from "@/components/period-control";
import { AcceptRateCard, CategoryDonut } from "@/components/stats";
import { useSkillStats } from "@/lib/hooks/stats";
import { formatPct } from "@/lib/format";
import { DEFAULT_PERIOD, periodLabel, type StatsPeriod } from "@/lib/period";
import { s } from "./styles";

export function StatsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const [period, setPeriod] = React.useState<StatsPeriod>(DEFAULT_PERIOD);
  const { data, isLoading, isError, isFetching, refetch } = useSkillStats(skill.id, period);
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

      {!isLoading && !isError && data && data.used_by_agents === 0 && (
        <EmptyState icon="BarChart" title={t("stats.empty.title")} body={t("stats.empty.body")} />
      )}

      {!isLoading && !isError && data && data.used_by_agents > 0 && (
        <>
          <div style={s.cards}>
            <MetricCard
              label={t("stats.cards.usedBy")}
              value={t("stats.cards.usedByUnit", { count: data.used_by_agents })}
            />
            <MetricCard
              label={`${t("stats.cards.pullFrequency")} (${label})`}
              value={formatPct(data.pull_frequency)}
            />
            <AcceptRateCard label={t("stats.cards.acceptRate")} rate={data.accept_rate} />
            <MetricCard
              label={`${t("stats.cards.findings")} (${label})`}
              value={data.findings_total}
            />
          </div>

          <div style={s.panels}>
            <div style={s.panel}>
              <div style={s.panelTitle}>{t("stats.agentsUsing")}</div>
              {data.agents.length === 0 ? (
                <span style={s.muted}>{t("stats.noAgents")}</span>
              ) : (
                data.agents.map((a) => (
                  <div key={a.agent_id} style={s.agentRow}>
                    <Icon.Cpu size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                    <span style={s.agentName}>{a.agent_name}</span>
                    <Link href={`/agents/${a.agent_id}`} style={s.openLink}>
                      {t("stats.open")}
                    </Link>
                  </div>
                ))
              )}
            </div>
            <div style={s.panel}>
              <div style={s.panelTitle}>{t("stats.findingsByCategory")}</div>
              <CategoryDonut
                data={data.findings_by_category}
                emptyLabel={t("stats.noData")}
                ariaLabel={t("stats.findingsByCategory")}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
