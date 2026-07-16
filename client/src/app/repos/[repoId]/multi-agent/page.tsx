/* Multi-Agent Review — /repos/:repoId/multi-agent. Composition root that switches
   between Configure-run mode (pick a PR + agents, launch) and Results mode
   (per-agent Columns or Tabs + the cross-agent Conflicts block), and hosts the
   lifted RunTraceDrawer. Business/data logic lives in the hooks; this file only
   wires the mode/view switch and the shared drawer. */
"use client";

import React from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Segmented, Skeleton } from "@devdigest/ui";
import type { AgentColumn } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import RunTraceDrawer from "@/components/run-trace";
import { usePulls } from "@/lib/hooks/core";
import { usePrReviews } from "@/lib/hooks/reviews";
import { useMultiAgentRun } from "@/lib/hooks/multi-agent";
import { useActiveRepo } from "@/lib/repo-context";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { formatCost } from "@/lib/format";
import { ConfigureRun } from "./_components/ConfigureRun";
import { ColumnsView } from "./_components/ColumnsView";
import { TabsView } from "./_components/TabsView";
import { ConflictsBlock } from "./_components/ConflictsBlock";

type View = "columns" | "tabs";
type TraceTarget = { runId: string; agentName: string; running: boolean };

export default function MultiAgentReviewPage() {
  const t = useTranslations("runs");
  const { repoId } = useParams<{ repoId: string }>();
  const search = useSearchParams();
  const { activeRepo } = useActiveRepo();

  const [prId, setPrId] = React.useState<string | null>(() => search.get("pr"));
  // Explicit "Configure run" override — returns to Configure from Results (AC-3).
  const [configuring, setConfiguring] = React.useState(false);
  const [view, setView] = React.useState<View>("columns");
  const [trace, setTrace] = React.useState<TraceTarget | null>(null);

  const { data: run, isLoading: runLoading } = useMultiAgentRun(prId);
  const { data: pulls } = usePulls(repoId);
  const { data: reviews } = usePrReviews(prId);

  const prTitle = React.useMemo(
    () => (pulls ?? []).find((p) => (p.id ?? String(p.number)) === prId)?.title ?? null,
    [pulls, prId],
  );

  // The existing run's agent ids — passed to ConfigureRun so re-configuring a PR that
  // already has a multi-run pre-checks that run's agents (Fix 2).
  const initialAgentIds = React.useMemo(
    () => run?.columns.map((c) => c.agent_id) ?? [],
    [run],
  );

  const repoName = activeRepo?.full_name ?? repoId;
  const inResults = !configuring && prId != null && run != null;
  // The selected PR already has a completed multi-run → Configure can offer "View results"
  // (Fix 5). Reacts to the Step-1 PR selection via useMultiAgentRun(prId); the !runLoading
  // guard keeps the button absent while the newly-selected PR's run is still loading.
  const hasResults = run != null && !runLoading;

  useDocumentTitle(`${t("page.title")} · ${repoName} · DevDigest`);

  const crumb = [
    { label: repoName, mono: true, href: `/repos/${repoId}/pulls` },
    { label: t("page.crumb"), href: `/repos/${repoId}/multi-agent` },
    {
      label: inResults && run?.pr_number != null ? `#${run.pr_number}` : t("page.configureRun"),
      mono: inResults,
    },
  ];

  const openTrace = React.useCallback((col: AgentColumn) => {
    setTrace({ runId: col.run_id, agentName: col.agent_name, running: col.status === "running" });
  }, []);

  const traceFindings = React.useMemo(
    () => (reviews ?? []).filter((r) => r.run_id === trace?.runId).flatMap((r) => r.findings),
    [reviews, trace],
  );

  // ---- Configure mode: no run yet, or the user asked to reconfigure (AC-2/AC-3).
  if (!inResults) {
    return (
      <AppShell crumb={crumb}>
        <div style={PAGE}>
          {configuring === false && prId != null && runLoading ? (
            <Skeleton height={320} />
          ) : (
            <ConfigureRun
              repoId={repoId}
              prId={prId}
              initialAgentIds={initialAgentIds}
              hasResults={hasResults}
              onSelectPr={setPrId}
              onViewResults={() => setConfiguring(false)}
              onLaunched={(id) => {
                setPrId(id);
                setConfiguring(false);
              }}
            />
          )}
        </div>
      </AppShell>
    );
  }

  // ---- Results mode. (inResults already implies both are set; narrow for TS.)
  if (run == null || prId == null) return null;
  const totalSeconds = Math.round(run.total_duration_ms / 1000);
  return (
    <AppShell crumb={crumb}>
      <div style={PAGE}>
        <header style={HEADER}>
          <div style={HEADER_TOP}>
            <div style={{ flex: 1 }}>
              <h1 style={TITLE}>{t("page.title")}</h1>
              <div style={SUBTLE}>{t("page.selectedAgents", { count: run.agent_count })}</div>
            </div>
            <Button kind="secondary" size="sm" icon="Settings" onClick={() => setConfiguring(true)}>
              {t("page.configureRun")}
            </Button>
            <Segmented
              ariaLabel={t("page.title")}
              value={view}
              onChange={(v) => setView(v as View)}
              options={[
                { value: "columns", label: t("page.view.columns") },
                { value: "tabs", label: t("page.view.tabs") },
              ]}
            />
          </div>
          <div style={HEADER_META}>
            <span className="mono" style={PRLINE}>
              {run.pr_number != null ? `#${run.pr_number}` : ""} {prTitle ?? ""}
            </span>
            <span style={SUBTLE}>
              {t("page.meta", {
                count: run.agent_count,
                duration: totalSeconds,
                cost: formatCost(run.total_cost_usd),
              })}
            </span>
          </div>
        </header>

        {view === "columns" ? (
          <ColumnsView run={run} onOpenTrace={openTrace} />
        ) : (
          <TabsView run={run} prId={prId} onOpenTrace={openTrace} />
        )}

        <ConflictsBlock conflicts={run.conflicts} />
      </div>

      {trace && (
        <RunTraceDrawer
          runId={trace.runId}
          agentName={trace.agentName}
          prNumber={run.pr_number ?? null}
          running={trace.running}
          findings={traceFindings}
          onClose={() => setTrace(null)}
        />
      )}
    </AppShell>
  );
}

const PAGE: React.CSSProperties = {
  padding: "28px 32px 48px",
  display: "flex",
  flexDirection: "column",
  gap: 24,
  maxWidth: 1280,
  margin: "0 auto",
};
const HEADER: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 10 };
const HEADER_TOP: React.CSSProperties = { display: "flex", alignItems: "center", gap: 16 };
const HEADER_META: React.CSSProperties = { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, flexWrap: "wrap" };
const TITLE: React.CSSProperties = { fontSize: 20, fontWeight: 700, color: "var(--text-primary)", margin: 0 };
const SUBTLE: React.CSSProperties = { fontSize: 13, color: "var(--text-muted)" };
const PRLINE: React.CSSProperties = { fontSize: 14, color: "var(--text-secondary)" };
