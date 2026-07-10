/* AgentDashboardView — the /eval per-agent view (Mockup 3). Back link, model
   chip, agent switcher, "Run eval", a code-computed regression alert banner
   (aria-live), three MetricCards (value + signed delta + mini sparkline), a
   multi-series metric-trend chart, and a recent-runs table with checkbox compare
   (exactly 2 selected → Compare modal). Fewer than two completed runs → no
   delta / no alert. Null metrics render "—" (AC-18). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Badge, Icon, SelectInput, MetricCard, LineChart, EmptyState, Skeleton } from "@devdigest/ui";
import type { EvalSuiteRun } from "@devdigest/shared";
import { useEvalDashboard, useRunAgentEvals, anyRunning } from "@/lib/hooks/eval";
import { useAgents } from "@/lib/hooks/agents";
import { CompareModal } from "@/components/eval/CompareModal";
import { fmtPct } from "@/components/eval/helpers";
import { MetricCell, METRIC_COLORS } from "@/components/eval/MetricCell";

export function AgentDashboardView({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const router = useRouter();
  const { data: dash, isLoading } = useEvalDashboard(agentId);
  const { data: agents } = useAgents();
  const runEval = useRunAgentEvals(agentId);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [comparing, setComparing] = React.useState<{ a: string; b: string } | null>(null);

  const toggleSelect = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  if (isLoading || !dash) {
    return <Skeleton height={320} />;
  }

  const { current, delta, trend } = dash;
  // The POST returns at enqueue (fire-and-forget suite), so the button's busy
  // state binds to the job's REAL signal — a `running` suite in recent_runs
  // (the same predicate that drives the dashboard's 4s poll) — with the
  // mutation's isPending bridging the POST→refetch window.
  const suiteRunning = anyRunning(dash.recent_runs);
  const hasDelta = delta.recall != null || delta.precision != null || delta.citation_accuracy != null;
  const trendSeries = [
    { name: t("dashboard.legend.recall"), color: METRIC_COLORS.recall, data: trend.map((p) => p.recall ?? 0) },
    { name: t("dashboard.legend.precision"), color: METRIC_COLORS.precision, data: trend.map((p) => p.precision ?? 0) },
    { name: t("dashboard.legend.citation"), color: METRIC_COLORS.citation, data: trend.map((p) => p.citation_accuracy ?? 0) },
  ];
  const recallTrend = trend.map((p) => p.recall ?? 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Button kind="ghost" size="sm" onClick={() => router.push("/eval")}>{t("dashboard.allAgentsBack")}</Button>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>{dash.agent_name}</h1>
        <Badge color="var(--text-secondary)" mono>{dash.model}</Badge>
        <div style={{ flex: 1 }} aria-hidden />
        {agents && agents.length > 1 && (
          <div style={{ width: 200 }}>
            <SelectInput
              value={agentId}
              onChange={(v) => router.push(`/eval?agent=${v}`)}
              options={agents.map((a) => ({ value: a.id, label: a.name }))}
              mono={false}
            />
          </div>
        )}
        <Button kind="primary" size="sm" icon="Play" loading={runEval.isPending || suiteRunning} onClick={() => runEval.mutate()}>
          {t("dashboard.runEvalPlain")}
        </Button>
      </div>

      {/* code-computed regression alert (announced) */}
      <div aria-live="polite">
        {dash.alert && (
          <div
            role="alert"
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 9, border: "1px solid var(--warn)", background: "var(--warn-bg)", color: "var(--warn)", fontSize: 13, fontWeight: 600 }}
          >
            <Icon.AlertTriangle size={16} />
            {dash.alert}
          </div>
        )}
      </div>

      {/* metric cards */}
      <div style={{ display: "flex", gap: 12 }}>
        <MetricCard
          label={t("dashboard.metrics.recall")}
          value={fmtPct(current.recall)}
          {...(hasDelta && delta.recall != null ? { delta: delta.recall } : {})}
          trend={recallTrend.length > 1 ? recallTrend : undefined}
          color={METRIC_COLORS.recall}
        />
        <MetricCard
          label={t("dashboard.metrics.precision")}
          value={fmtPct(current.precision)}
          {...(hasDelta && delta.precision != null ? { delta: delta.precision } : {})}
          trend={trend.length > 1 ? trend.map((p) => p.precision ?? 0) : undefined}
          color={METRIC_COLORS.precision}
        />
        <MetricCard
          label={t("dashboard.metrics.citationAccuracy")}
          value={fmtPct(current.citation_accuracy)}
          {...(hasDelta && delta.citation_accuracy != null ? { delta: delta.citation_accuracy } : {})}
          trend={trend.length > 1 ? trend.map((p) => p.citation_accuracy ?? 0) : undefined}
          color={METRIC_COLORS.citation}
        />
      </div>

      {/* metric trend chart */}
      {trend.length > 1 && (
        <section>
          <SectionHeading>{t("dashboard.metricTrend")}</SectionHeading>
          <LineChart series={trendSeries} />
        </section>
      )}

      {/* recent runs + checkbox compare */}
      <section>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <SectionHeading noMargin>{t("dashboard.recentRuns")}</SectionHeading>
          <div style={{ flex: 1 }} aria-hidden />
          <Button
            kind="secondary"
            size="sm"
            disabled={selected.length !== 2}
            onClick={() => selected.length === 2 && setComparing({ a: selected[0]!, b: selected[1]! })}
          >
            {t("dashboard.compare")}
          </Button>
        </div>
        {dash.recent_runs.length === 0 ? (
          <EmptyState icon="FlaskConical" title={t("dashboard.defaultTitle")} body={t("dashboard.noRuns")} />
        ) : (
          <RecentRunsTable runs={dash.recent_runs} selected={selected} onToggle={toggleSelect} />
        )}
      </section>

      {comparing && <CompareModal a={comparing.a} b={comparing.b} onClose={() => setComparing(null)} />}
    </div>
  );
}

function SectionHeading({ children, noMargin }: { children: React.ReactNode; noMargin?: boolean }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", color: "var(--text-muted)", marginBottom: noMargin ? 0 : 10 }}>
      {String(children).toUpperCase()}
    </div>
  );
}

function RecentRunsTable({
  runs,
  selected,
  onToggle,
}: {
  runs: EvalSuiteRun[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const t = useTranslations("eval");
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
          <th style={cell} aria-label="select" />
          <th style={cell}>{t("dashboard.table.ranAt")}</th>
          <th style={cell}>{t("dashboard.version")}</th>
          <th style={cell}>{t("dashboard.table.recall")}</th>
          <th style={cell}>{t("dashboard.table.precision")}</th>
          <th style={cell}>{t("dashboard.table.citation")}</th>
          <th style={cell}>{t("dashboard.table.pass")}</th>
          <th style={cell}>{t("dashboard.table.cost")}</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
            <td style={cell}>
              <input
                type="checkbox"
                aria-label={`compare ${new Date(r.ran_at).toLocaleString()}`}
                checked={selected.includes(r.id)}
                onChange={() => onToggle(r.id)}
              />
            </td>
            <td style={cell}>{new Date(r.ran_at).toLocaleString()}</td>
            <td style={cell}>v{r.agent_version}</td>
            <td style={cell}><MetricCell value={r.recall} color={METRIC_COLORS.recall} /></td>
            <td style={cell}><MetricCell value={r.precision} color={METRIC_COLORS.precision} /></td>
            <td style={cell}><MetricCell value={r.citation_accuracy} color={METRIC_COLORS.citation} /></td>
            <td style={cell} className="tnum">{r.passed}/{r.total}</td>
            <td style={cell} className="tnum">{r.cost_usd == null ? "—" : `$${r.cost_usd.toFixed(2)}`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const cell: React.CSSProperties = { padding: "8px 10px" };
