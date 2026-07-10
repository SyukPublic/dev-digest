/* AllAgentsView — the /eval all-agents overview (Mockup 2). Per-agent rows
   (model chip, last-run summary, sparkline, RECALL/PREC/CITE) + a recent-runs-
   across-agents table + "Run all agents". Never-run agents render "—". */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Badge, Icon, Sparkline, EmptyState, Skeleton } from "@devdigest/ui";
import type { EvalAgentSummary, EvalSuiteRun } from "@devdigest/shared";
import { useWorkspaceEvalDashboard, useRunAllAgents } from "@/lib/hooks/eval";
import { fmtPct } from "@/components/eval/helpers";

export function AllAgentsView() {
  const t = useTranslations("eval");
  const router = useRouter();
  const { data, isLoading } = useWorkspaceEvalDashboard();
  const runAll = useRunAllAgents();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>{t("dashboard.defaultTitle")}</h1>
          <p style={{ fontSize: 14, color: "var(--text-muted)", marginTop: 4 }}>{t("dashboard.subtitle")}</p>
        </div>
        <Button kind="primary" icon="Play" loading={runAll.isPending} onClick={() => runAll.mutate()}>
          {t("dashboard.runAllAgents")}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton height={160} />
      ) : !data || data.agents.length === 0 ? (
        <EmptyState icon="Cpu" title={t("dashboard.defaultTitle")} body={t("dashboard.noAgents")} />
      ) : (
        <>
          <section>
            <SectionHeading>{t("dashboard.agentsHeading")}</SectionHeading>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {data.agents.map((a) => (
                <AgentRow key={a.agent_id} a={a} onOpen={() => router.push(`/eval?agent=${a.agent_id}`)} />
              ))}
            </div>
          </section>

          <section>
            <SectionHeading>{t("dashboard.recentAllAgents")}</SectionHeading>
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

function AgentRow({ a, onOpen }: { a: EvalAgentSummary; onOpen: () => void }) {
  const t = useTranslations("eval");
  const last = a.last_run;
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
      }}
    >
      <Icon.Cpu size={18} style={{ color: "var(--accent)", flexShrink: 0 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.agent_name}</span>
          <Badge color="var(--text-secondary)" mono>{a.model}</Badge>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
          {last
            ? t("dashboard.lastRun", { version: last.agent_version, passed: last.passed, total: last.total })
            : t("dashboard.neverRun")}
        </div>
      </div>
      {a.sparkline.length > 1 && <Sparkline data={a.sparkline} w={72} h={22} />}
      <MetricMini label={t("dashboard.metrics.recall")} value={fmtPct(a.current.recall)} />
      <MetricMini label={t("dashboard.metrics.precision")} value={fmtPct(a.current.precision)} />
      <MetricMini label={t("dashboard.metrics.citationAccuracy")} value={fmtPct(a.current.citation_accuracy)} />
    </button>
  );
}

function MetricMini({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: "right", minWidth: 64 }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.03em", color: "var(--text-muted)" }}>{label}</div>
      <div className="tnum" style={{ fontSize: 15, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function RecentRunsTable({ runs }: { runs: EvalSuiteRun[] }) {
  const t = useTranslations("eval");
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
          <th style={cell}>{t("dashboard.agent")}</th>
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
            <td style={cell}>{r.agent_name ?? "—"}</td>
            <td style={cell}>{new Date(r.ran_at).toLocaleString()}</td>
            <td style={cell}>v{r.agent_version}</td>
            <td style={{ ...cell }} className="tnum">{fmtPct(r.recall)}</td>
            <td style={{ ...cell }} className="tnum">{fmtPct(r.precision)}</td>
            <td style={{ ...cell }} className="tnum">{fmtPct(r.citation_accuracy)}</td>
            <td style={{ ...cell }} className="tnum">{r.passed}/{r.total}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const cell: React.CSSProperties = { padding: "8px 10px" };
