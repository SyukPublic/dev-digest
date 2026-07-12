/* AllSkillsView — the /eval?tab=skills all-skills overview. Mirrors
   AllAgentsView 1:1: per-skill rows (enabled-dim, last-run summary, RECALL/PREC/
   CITE minis + sparklines) + a recent-runs-across-skills table + "Run all
   skills". A skill has no model/prompt, so it is scored as a DELTA on a host
   agent's review; runs carry the host that produced them. Never-run skills
   render "—" (AC-14). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Badge, Icon, Sparkline, EmptyState, Skeleton } from "@devdigest/ui";
import type { EvalSkillSummary, EvalSkillSuiteRun } from "@devdigest/shared";
import { useWorkspaceSkillEvalDashboard, useRunAllSkills, anyRunning } from "@/lib/hooks/eval";
import { fmtPct } from "@/components/eval/helpers";
import { MetricCell, METRIC_COLORS } from "@/components/eval/MetricCell";

export function AllSkillsView() {
  const t = useTranslations("eval");
  const router = useRouter();
  const { data, isLoading } = useWorkspaceSkillEvalDashboard();
  const runAll = useRunAllSkills();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>{t("skillsDashboard.heading")}</h1>
          <p style={{ fontSize: 14, color: "var(--text-muted)", marginTop: 4 }}>{t("skillsDashboard.subtitle")}</p>
        </div>
        {/* Fire-and-forget POST → busy binds to the running suites in recent_runs
            (the predicate that drives the 4s poll), isPending bridging the gap. */}
        <Button
          kind="primary"
          icon="Play"
          loading={runAll.isPending || anyRunning(data?.recent_runs)}
          onClick={() => runAll.mutate()}
        >
          {t("skillsDashboard.runAllSkills")}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton height={160} />
      ) : !data || data.skills.length === 0 ? (
        <EmptyState icon="Sparkles" title={t("skillsDashboard.heading")} body={t("skillsDashboard.noSkills")} />
      ) : (
        <>
          <section>
            <SectionHeading>{t("skillsDashboard.heading")}</SectionHeading>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {data.skills.map((s) => (
                <SkillRow
                  key={s.skill_id}
                  s={s}
                  onOpen={() => router.push(`/eval?tab=skills&skill=${s.skill_id}`)}
                />
              ))}
            </div>
          </section>

          <section>
            <SectionHeading>{t("skillsDashboard.recentAllSkills")}</SectionHeading>
            {data.recent_runs.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("dashboard.noRuns")}</div>
            ) : (
              <RecentRunsTable runs={data.recent_runs} />
            )}
          </section>
        </>
      )}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", color: "var(--text-muted)", marginBottom: 10 }}>
      {String(children).toUpperCase()}
    </div>
  );
}

function SkillRow({ s, onOpen }: { s: EvalSkillSummary; onOpen: () => void }) {
  const t = useTranslations("eval");
  const last = s.last_run;
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 16px",
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--bg-surface)",
        textAlign: "left",
        cursor: "pointer",
        width: "100%",
        // Disabled skills stay listed but render dimmed (mirrors the Skills page).
        opacity: s.enabled ? 1 : 0.6,
      }}
    >
      <Icon.Sparkles size={18} style={{ color: "var(--accent)", flexShrink: 0 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.skill_name}</span>
          {last && last.host_agent_name != null && (
            <Badge color="var(--text-secondary)">
              {t("skillsDashboard.hostLabel", { name: last.host_agent_name, version: last.host_agent_version })}
            </Badge>
          )}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
          {last
            ? t("dashboard.lastRun", { version: last.skill_version, passed: last.passed, total: last.total })
            : t("skillsDashboard.neverRun")}
        </div>
      </div>
      <MetricMini
        label={t("dashboard.metrics.recall")}
        value={fmtPct(s.current.recall)}
        trend={s.sparklines.recall}
        color={METRIC_COLORS.recall}
      />
      <MetricMini
        label={t("dashboard.metrics.precision")}
        value={fmtPct(s.current.precision)}
        trend={s.sparklines.precision}
        color={METRIC_COLORS.precision}
      />
      <MetricMini
        label={t("dashboard.metrics.citationShort")}
        value={fmtPct(s.current.citation_accuracy)}
        trend={s.sparklines.citation_accuracy}
        color={METRIC_COLORS.citation}
      />
    </button>
  );
}

function MetricMini({
  label,
  value,
  trend,
  color,
}: {
  label: string;
  value: string;
  /** Per-metric sparkline series; hidden until there are 2+ points. */
  trend?: number[];
  color: string;
}) {
  return (
    <div style={{ textAlign: "right", minWidth: 64 }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.03em", color: "var(--text-muted)" }}>{label}</div>
      <div className="tnum" style={{ fontSize: 15, fontWeight: 700 }}>{value}</div>
      {trend && trend.length > 1 && (
        // decorative — the value above carries the number in text
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 3 }} aria-hidden>
          <Sparkline data={trend} color={color} w={64} h={14} />
        </div>
      )}
    </div>
  );
}

function RecentRunsTable({ runs }: { runs: EvalSkillSuiteRun[] }) {
  const t = useTranslations("eval");
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
          <th style={cell}>{t("tabs.skills")}</th>
          <th style={cell}>{t("skillCompare.host")}</th>
          <th style={cell}>{t("dashboard.table.ranAt")}</th>
          <th style={cell}>{t("dashboard.version")}</th>
          <th style={cell}>{t("dashboard.table.recall")}</th>
          <th style={cell}>{t("dashboard.table.precision")}</th>
          <th style={cell}>{t("dashboard.table.citation")}</th>
          <th style={cell}>{t("dashboard.table.pass")}</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
            <td style={cell}>{r.skill_name ?? "—"}</td>
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
            <td style={{ ...cell }} className="tnum">{r.passed}/{r.total}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const cell: React.CSSProperties = { padding: "8px 10px" };
