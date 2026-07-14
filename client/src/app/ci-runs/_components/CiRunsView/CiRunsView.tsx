/* /ci-runs — global CI Runs page. Lists automated agent reviews executed inside
   CI (agent_runs where source='ci'), not local studio runs. Reuses RunCostBadge
   + SeverityCountBadges for the FINDINGS/COST cells. Filters are applied
   client-side over the server's 7-day window; Refresh + a 30s auto-refresh both
   re-run the server ingest (pull-on-refresh, no webhooks). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton, Toggle } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useCiRuns, useIngestCiRuns } from "@/lib/hooks/ci-runs";
import { CiRunRow } from "./CiRunRow";
import { CiRunsFilters, type CiRunFilterState } from "./CiRunsFilters";
import { ALL } from "./constants";
import { distinct, statusOf } from "./helpers";
import { s } from "./styles";

const REFRESH_INTERVAL_MS = 30_000;

export function CiRunsView() {
  const t = useTranslations("ci");
  const [autoRefresh, setAutoRefresh] = React.useState(false);
  const [filters, setFilters] = React.useState<CiRunFilterState>({
    agent: ALL,
    repo: ALL,
    status: ALL,
    source: ALL,
  });

  const { data, isLoading, isError, refetch } = useCiRuns({ autoRefresh });
  const ingest = useIngestCiRuns();

  const runs = React.useMemo(() => data ?? [], [data]);
  // Every CI run currently arrives via GitHub Actions; the source cell + filter
  // use that single display label.
  const sourceLabel = t("exportWizard.targets.gha");

  const agents = React.useMemo(() => distinct(runs, "agent_name"), [runs]);
  const repos = React.useMemo(() => distinct(runs, "repo"), [runs]);
  const sources = React.useMemo(
    () => (runs.some((r) => r.source) ? [sourceLabel] : []),
    [runs, sourceLabel],
  );

  const filtered = React.useMemo(
    () =>
      runs.filter((r) => {
        if (filters.agent !== ALL && r.agent_name !== filters.agent) return false;
        if (filters.repo !== ALL && r.repo !== filters.repo) return false;
        if (filters.status !== ALL && statusOf(r) !== filters.status) return false;
        if (filters.source !== ALL && (r.source ? sourceLabel : "") !== filters.source) return false;
        return true;
      }),
    [runs, filters, sourceLabel],
  );

  const onFilterChange = React.useCallback(
    (patch: Partial<CiRunFilterState>) => setFilters((f) => ({ ...f, ...patch })),
    [],
  );

  // Refresh + 30s auto-refresh both re-run the server ingest, then the list
  // invalidation (in the hook) refetches. Keep a ref so the interval effect
  // doesn't re-subscribe on every render.
  const runIngest = React.useCallback(() => ingest.mutate(), [ingest]);
  const runIngestRef = React.useRef(runIngest);
  runIngestRef.current = runIngest;

  React.useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => runIngestRef.current(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [autoRefresh]);

  return (
    <AppShell crumb={[{ label: t("page.crumb") }]}>
      {/* Non-disruptive announcement of refresh activity. */}
      <div aria-live="polite" role="status" style={s.srOnly}>
        {ingest.isPending ? t("runs.refreshing") : ""}
      </div>

      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("runs.title")}</h1>
            <p style={s.subtitle}>{t("runs.subtitle")}</p>
          </div>
          <div style={s.headerActions}>
            {autoRefresh && (
              <span style={s.autoRefreshLabel}>
                <span aria-hidden>●</span>
                {t("runs.autoRefresh")}
              </span>
            )}
            <span style={s.autoRefreshBox} role="group" aria-label={t("runs.autoRefresh")}>
              <Toggle on={autoRefresh} onChange={setAutoRefresh} />
            </span>
            <Button
              kind="ghost"
              size="sm"
              icon="RefreshCw"
              onClick={runIngest}
              disabled={ingest.isPending}
            >
              {ingest.isPending ? t("runs.refreshing") : t("runs.refresh")}
            </Button>
          </div>
        </div>

        <CiRunsFilters
          filters={filters}
          onChange={onFilterChange}
          agents={agents}
          repos={repos}
          sources={sources}
        />

        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton height={44} />
            <Skeleton height={44} />
            <Skeleton height={44} />
          </div>
        )}

        {isError && <ErrorState onRetry={() => refetch()} />}

        {!isLoading && !isError && runs.length === 0 && (
          <EmptyState icon="Activity" title={t("runs.emptyTitle")} body={t("runs.emptyBody")} />
        )}

        {!isLoading && !isError && runs.length > 0 && (
          <div style={s.table} role="table" aria-label={t("runs.title")}>
            <div style={s.headRow} role="row">
              <span role="columnheader">{t("runs.table.timestamp")}</span>
              <span role="columnheader">{t("runs.table.pullRequest")}</span>
              <span role="columnheader">{t("runs.table.agent")}</span>
              <span role="columnheader">{t("runs.table.source")}</span>
              <span role="columnheader">{t("runs.table.duration")}</span>
              <span role="columnheader">{t("runs.table.findings")}</span>
              <span role="columnheader">{t("runs.table.cost")}</span>
              <span role="columnheader">{t("runs.table.status")}</span>
              <span role="columnheader" style={{ justifySelf: "end" }}>
                {t("runs.table.trace")}
              </span>
            </div>
            {filtered.map((run) => (
              <CiRunRow key={run.run_id} run={run} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
