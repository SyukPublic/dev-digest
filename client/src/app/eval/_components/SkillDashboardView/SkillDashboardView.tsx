/* SkillDashboardView — the /eval?tab=skills&skill=<id> per-skill differential
   dashboard (mirror of AgentDashboardView). Back link → the all-skills overview,
   the skill name + latest skill-version badge, a HostAgentPicker + "Run eval"
   (a skill is scored as a delta on a host agent's review), a code-computed
   regression alert banner (aria-live), three delta MetricCards (value + signed
   delta + mini sparkline), a multi-series metric-trend chart, and a recent-runs
   table with checkbox compare (exactly 2 selected → SkillCompareModal). The
   per-run skill version + host id/version + cost are surfaced in the recent-runs
   table (the vendored LineChart carries no per-point tooltip). Fewer than two
   completed runs → no delta / no alert. Null metrics render "—" (AC-14). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Badge, Icon, MetricCard, LineChart, EmptyState, Skeleton } from "@devdigest/ui";
import type {
  EvalSkillSuiteRun,
  EvalSkillStabilitySummary,
  EvalSkillCaseStability,
  EvalSkillStabilityAlert,
  EvalMetricStat,
} from "@devdigest/shared";
import { useSkillEvalDashboard, useRunSkillEvals, useStartSkillStability, anyRunning } from "@/lib/hooks/eval";
import { HostAgentPicker } from "@/components/eval/HostAgentPicker";
import { SkillCompareModal } from "@/components/eval/SkillCompareModal";
import { fmtPct } from "@/components/eval/helpers";
import { STABILITY_MIN_N, STABILITY_MAX_N } from "@/components/eval/constants";
import { MetricCell, METRIC_COLORS } from "@/components/eval/MetricCell";

/** The three rate metrics the variance block surfaces (cost is shown separately). */
const RATE_METRICS = ["recall", "precision", "citation_accuracy"] as const;
type RateMetric = (typeof RATE_METRICS)[number];

export function SkillDashboardView({ skillId }: { skillId: string }) {
  const t = useTranslations("eval");
  const router = useRouter();
  const { data: dash, isLoading } = useSkillEvalDashboard(skillId);
  const runEval = useRunSkillEvals(skillId);
  const startStability = useStartSkillStability(skillId);
  const [host, setHost] = React.useState<string | null>(null);
  const [repeatN, setRepeatN] = React.useState<number>(3);
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
  // A stability group is a background job too — its running status drives the
  // stability button's busy state and blocks a second concurrent group.
  const groupRunning = dash.stability_group?.status === "running";
  const hasDelta = delta.recall != null || delta.precision != null || delta.citation_accuracy != null;
  // Latest run's skill version (recent_runs is newest-first) for the header badge.
  const latestVersion = dash.recent_runs[0]?.skill_version;
  const trendSeries = [
    { name: t("dashboard.legend.recall"), color: METRIC_COLORS.recall, data: trend.map((p) => p.recall ?? 0) },
    { name: t("dashboard.legend.precision"), color: METRIC_COLORS.precision, data: trend.map((p) => p.precision ?? 0) },
    { name: t("dashboard.legend.citation"), color: METRIC_COLORS.citation, data: trend.map((p) => p.citation_accuracy ?? 0) },
  ];
  const recallTrend = trend.map((p) => p.recall ?? 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Button kind="ghost" size="sm" onClick={() => router.push("/eval?tab=skills")}>{t("skillsDashboard.allSkillsBack")}</Button>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>{dash.skill_name}</h1>
        {latestVersion != null && <Badge color="var(--text-secondary)" mono>v{latestVersion}</Badge>}
        <div style={{ flex: 1 }} aria-hidden />
        {/* Controls bottom-align to the host-picker's select box (its stacked label
            makes it taller than the buttons) — mirrors the SkillEditor Evals tab. */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
          <HostAgentPicker skillId={skillId} value={host} onChange={setHost} disabled={suiteRunning} />
          <Button
            kind="primary"
            size="sm"
            icon="Play"
            loading={runEval.isPending || suiteRunning}
            disabled={!host}
            onClick={() => host && runEval.mutate(host)}
          >
            {t("dashboard.runEvalPlain")}
          </Button>
          {/* Stability: repeat the frozen snapshot N times to sample variance. */}
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-secondary)" }}>
            {t("stability.repeatLabel")}
            <select
              aria-label={t("stability.repeatLabel")}
              value={repeatN}
              disabled={groupRunning}
              onChange={(e) => setRepeatN(Number(e.target.value))}
              style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}
            >
              {Array.from({ length: STABILITY_MAX_N - STABILITY_MIN_N + 1 }, (_, i) => STABILITY_MIN_N + i).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <Button
            kind="secondary"
            size="sm"
            icon="Gauge"
            loading={startStability.isPending || groupRunning}
            disabled={!host}
            onClick={() => host && startStability.mutate({ hostAgentId: host, n: repeatN })}
          >
            {t("stability.runStability")}
          </Button>
        </div>
      </div>

      {/* code-computed regression alert + noise-aware annotation (announced) */}
      <div aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {dash.alert && (
          <div
            role="alert"
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 9, border: "1px solid var(--warn)", background: "var(--warn-bg)", color: "var(--warn)", fontSize: 13, fontWeight: 600 }}
          >
            <Icon.AlertTriangle size={16} />
            {dash.alert}
          </div>
        )}
        {dash.stability_alert && <NoiseAwareAlert alert={dash.stability_alert} />}
      </div>

      {/* delta metric cards */}
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

      {/* stability: per-metric variance + per-case flaky / non-discriminating */}
      <StabilitySection summary={dash.stability} cases={dash.case_stability} />

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
          <EmptyState icon="FlaskConical" title={dash.skill_name} body={t("dashboard.noRuns")} />
        ) : (
          <RecentRunsTable runs={dash.recent_runs} selected={selected} onToggle={toggleSelect} />
        )}
      </section>

      {comparing && <SkillCompareModal a={comparing.a} b={comparing.b} onClose={() => setComparing(null)} />}
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
  runs: EvalSkillSuiteRun[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const t = useTranslations("eval");
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
          <th style={cell} aria-label="select" />
          <th style={cell}>{t("skillCompare.host")}</th>
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
            <td style={cell}>
              {r.host_agent_name == null
                ? t("skillCompare.hostUnavailable")
                : t("skillsDashboard.hostLabel", { name: r.host_agent_name, version: r.host_agent_version })}
            </td>
            <td style={cell}>{new Date(r.ran_at).toLocaleString()}</td>
            <td style={cell}>v{r.skill_version}</td>
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

/** stddev expressed in percentage points (same unit the band uses). */
function pts(stddev: number): number {
  return Math.round(stddev * 100);
}

/**
 * The noise-aware regression annotation (aria-live). A move BEYOND the sampled
 * band is a real regression (warn); a move WITHIN the band is dampened as noise
 * (muted). Colour is never the only signal — icon + text carry the state.
 */
function NoiseAwareAlert({ alert }: { alert: EvalSkillStabilityAlert }) {
  const t = useTranslations("eval");
  const metric = t(`stability.metrics.${alert.metric}`);
  const beyond = alert.beyond_band;
  return (
    <div
      role="note"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        borderRadius: 9,
        border: `1px solid ${beyond ? "var(--warn)" : "var(--border)"}`,
        background: beyond ? "var(--warn-bg)" : "var(--surface)",
        color: beyond ? "var(--warn)" : "var(--text-secondary)",
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      {beyond ? <Icon.AlertTriangle size={15} /> : <Icon.Info size={15} />}
      {beyond
        ? t("stability.alertBeyond", { metric, move: alert.move, band: alert.band })
        : t("stability.alertWithin", { metric, move: alert.move, band: alert.band })}
    </div>
  );
}

/** The stability layer's variance block + per-case flag list. */
function StabilitySection({
  summary,
  cases,
}: {
  summary: EvalSkillStabilitySummary | null;
  cases: EvalSkillCaseStability[];
}) {
  const t = useTranslations("eval");
  return (
    <section>
      <SectionHeading>{t("stability.heading")}</SectionHeading>
      {!summary ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("stability.noGroup")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {RATE_METRICS.map((m) => (
            <VarianceRow key={m} label={t(`stability.metrics.${m}`)} stat={summary[m]} />
          ))}
          <VarianceRow label={t("stability.metrics.cost")} stat={summary.cost} cost />
        </div>
      )}

      {cases.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <SectionHeading>{t("stability.casesHeading")}</SectionHeading>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {cases.map((c) => (
              <CaseStabilityRow key={c.case_id} c={c} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** One metric's `mean ± stddev (n)` with an indicative-only marker (icon + text). */
function VarianceRow({
  label,
  stat,
  cost,
}: {
  label: string;
  stat: EvalMetricStat | null;
  cost?: boolean;
}) {
  const t = useTranslations("eval");
  const value = !stat
    ? "—"
    : cost
      ? t("stability.costStat", { value: `$${stat.mean.toFixed(3)}`, band: `$${stat.stddev.toFixed(3)}`, n: stat.n })
      : t("stability.stat", { value: fmtPct(stat.mean), band: pts(stat.stddev), n: stat.n });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
      <span style={{ width: 96, color: "var(--text-muted)" }}>{label}</span>
      <span className="tnum">{value}</span>
      {stat?.indicative && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--text-muted)", fontSize: 12 }}>
          <Icon.Info size={13} />
          {t("stability.indicative")}
        </span>
      )}
    </div>
  );
}

/** One case's pass-rate + flaky / non-discriminating chips (icon + text). */
function CaseStabilityRow({ c }: { c: EvalSkillCaseStability }) {
  const t = useTranslations("eval");
  return (
    <li style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
      <span className="tnum" style={{ color: "var(--text-secondary)" }}>
        {t("stability.passRate", { rate: Math.round(c.pass_rate * 100), runs: c.runs })}
      </span>
      {c.flaky && (
        <Chip color="var(--warn)" icon={<Icon.Zap size={12} />}>
          {t("stability.flaky")}
        </Chip>
      )}
      {c.non_discriminating && (
        <Chip color="var(--text-muted)" icon={<Icon.Info size={12} />}>
          {t("stability.nonDiscriminating")}
        </Chip>
      )}
    </li>
  );
}

function Chip({ children, color, icon }: { children: React.ReactNode; color: string; icon: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 999,
        border: `1px solid ${color}`,
        color,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {icon}
      {children}
    </span>
  );
}

const cell: React.CSSProperties = { padding: "8px 10px" };
