/* EvalsTab — the AgentEditor "Evals" tab (Mockup 5). Metric summary tiles, the
   agent's eval-case list (status icon + TEXT label, mono name, subtitle,
   expectation chip, per-row run/edit/delete), "Run all evals", "New eval case",
   and a "View full dashboard →" link. Null metrics render "—" (AC-18). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Icon, Badge, EmptyState, Skeleton } from "@devdigest/ui";
import type { Agent, EvalCaseListItem } from "@devdigest/shared";
import {
  anyRunning,
  useAgentEvalCases,
  useEvalDashboard,
  useRunAgentEvals,
  useRunCase,
  useRunningCaseIds,
  useDeleteEvalCase,
} from "@/lib/hooks/eval";
import { CaseEditor } from "@/components/eval/CaseEditor";
import { fmtPct } from "@/components/eval/helpers";

type EditState = { mode: "new" } | { mode: "edit"; item: EvalCaseListItem } | null;

export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("eval");
  const router = useRouter();
  const qc = useQueryClient();
  const { data: dash } = useEvalDashboard(agent.id);
  // "Run all evals" is fire-and-forget on the server: the POST returns
  // immediately, so the REAL busy signal is a `running` suite in the polled
  // dashboard, not the mutation's isPending (client/INSIGHTS 2026-07-01).
  const suiteRunning = anyRunning(dash?.recent_runs);
  const { data: cases, isLoading } = useAgentEvalCases(agent.id, suiteRunning);
  const runAll = useRunAgentEvals(agent.id);
  const runCase = useRunCase(agent.id);
  const runningCaseIds = useRunningCaseIds();
  const del = useDeleteEvalCase(agent.id);
  const [edit, setEdit] = React.useState<EditState>(null);

  // Per-case rows are all persisted BEFORE the suite turns terminal, but the
  // last cases poll may predate the final rows — refetch once on the
  // running→terminal edge (prevRunningRef pattern, client/INSIGHTS 2026-06-24).
  const prevRunningRef = React.useRef(false);
  React.useEffect(() => {
    if (prevRunningRef.current && !suiteRunning) {
      void qc.invalidateQueries({ queryKey: ["eval-cases", agent.id] });
    }
    prevRunningRef.current = suiteRunning;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- edge detector on the single running signal; qc/agent.id are stable for a mounted tab
  }, [suiteRunning]);

  const current = dash?.current;
  // The server's `current` block is the newest COMPLETED suite run — surface
  // which one, so it is visible that single-case runs don't move these tiles.
  const lastSuite = (dash?.recent_runs ?? []).find((r) => r.status === "done");
  const passed = (cases ?? []).filter((c) => c.latest?.pass === true).length;
  const total = cases?.length ?? 0;

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      {/* metric summary tiles */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{t("evalsTab.metricsTitle")}</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("evalsTab.metricsSubtitle")}</div>
        </div>
        <Button kind="ghost" size="sm" onClick={() => router.push(`/eval?agent=${agent.id}`)}>
          {t("evalsTab.viewDashboard")}
        </Button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12 }}>
        <Tile label={t("dashboard.metrics.recall")} value={fmtPct(current?.recall)} />
        <Tile label={t("dashboard.metrics.precision")} value={fmtPct(current?.precision)} />
        <Tile label={t("dashboard.metrics.citationAccuracy")} value={fmtPct(current?.citation_accuracy)} />
        <Tile
          label={t("evalsTab.tracesPassed")}
          value={current ? `${current.traces_passed}/${current.traces_total}` : "—"}
        />
      </div>
      {lastSuite && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: -12 }}>
          {t("evalsTab.asOfSuiteRun", {
            version: lastSuite.agent_version,
            date: new Date(lastSuite.ran_at).toLocaleString(),
          })}
        </div>
      )}

      {/* cases header + controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{t("evalsTab.casesHeading")}</span>
        <Badge color="var(--text-secondary)">{t("evalsTab.casesCount", { passed, total })}</Badge>
        <div style={{ flex: 1 }} aria-hidden />
        <Button
          kind="secondary"
          size="sm"
          icon="Play"
          loading={runAll.isPending || suiteRunning}
          disabled={total === 0}
          onClick={() => runAll.mutate()}
        >
          {suiteRunning ? t("evalsTab.running") : t("evalsTab.runAll")}
        </Button>
        <Button kind="primary" size="sm" icon="Plus" onClick={() => setEdit({ mode: "new" })}>
          {t("evalsTab.newCase")}
        </Button>
      </div>

      {/* case list */}
      {isLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton height={44} />
          <Skeleton height={44} />
        </div>
      ) : total === 0 ? (
        <EmptyState icon="FlaskConical" title={t("evalsTab.casesHeading")} body={t("evalsTab.emptyCases")} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {cases!.map((c) => (
            <CaseRow
              key={c.id}
              item={c}
              runPending={runningCaseIds.includes(c.id)}
              onRun={() => runCase.mutate(c.id)}
              onEdit={() => setEdit({ mode: "edit", item: c })}
              onDelete={() => del.mutate(c.id)}
            />
          ))}
        </div>
      )}

      {edit && (
        <CaseEditor
          agent={agent}
          caseId={edit.mode === "edit" ? edit.item.id : undefined}
          lastRun={edit.mode === "edit" ? edit.item.latest : undefined}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 9, padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.03em", color: "var(--text-muted)" }}>{label}</div>
      <div className="tnum" style={{ fontSize: 26, fontWeight: 700, marginTop: 6 }}>{value}</div>
    </div>
  );
}

function CaseRow({
  item,
  runPending,
  onRun,
  onEdit,
  onDelete,
}: {
  item: EvalCaseListItem;
  runPending: boolean;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("eval");
  const status = item.latest == null ? "never" : item.latest.pass ? "pass" : "fail";
  const StatusIcon = status === "pass" ? Icon.CheckCircle : status === "fail" ? Icon.XCircle : Icon.Clock;
  const statusColor = status === "pass" ? "var(--ok)" : status === "fail" ? "var(--crit)" : "var(--text-muted)";
  const statusLabel =
    status === "never" ? t("evalsTab.neverRun") : status === "pass" ? t("evalsTab.passed") : t("evalsTab.failed");
  const subtitle =
    item.latest == null
      ? t("evalsTab.neverRun")
      : t("evalsTab.expectedGot", {
          expected: item.expected_count,
          actual: item.latest.actual_count ?? "—",
        });
  const chip =
    item.expectation === "must_not_flag" && item.expected_count === 0
      ? t("evalsTab.emptyExpectation")
      : `${item.expectation ?? "?"} · ${item.expected_count}`;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg-surface)" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: statusColor, fontSize: 12, fontWeight: 600, minWidth: 92 }}>
        <StatusIcon size={15} />
        {statusLabel}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="mono" style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.name}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{subtitle}</div>
      </div>
      <Badge color="var(--text-secondary)">{chip}</Badge>
      <Button kind="ghost" size="sm" icon="Play" loading={runPending} onClick={onRun} aria-label={t("evalsTab.run")}>
        {t("evalsTab.run")}
      </Button>
      <Button kind="ghost" size="sm" icon="Edit" onClick={onEdit} aria-label={t("evalsTab.edit")}>
        {t("evalsTab.edit")}
      </Button>
      <Button kind="ghost" size="sm" icon="Trash" onClick={onDelete} aria-label={t("evalsTab.delete")}>
        {t("evalsTab.delete")}
      </Button>
    </div>
  );
}
