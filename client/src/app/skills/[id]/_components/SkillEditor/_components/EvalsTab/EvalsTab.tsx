/* EvalsTab (skill) — the SkillEditor "Evals" tab. A skill has no model/prompt, so
   it is scored as a DELTA on a host agent's review: pick a host, run the host's
   review twice per case (WITHOUT then WITH the skill), score the findings the
   skill caused. Mirrors the AgentEditor EvalsTab, with three skill differences:
   (a) a "Run on evals" control that REQUIRES a host — the HostAgentPicker sits
   inline beside the Run button and Run is disabled until a host resolves;
   (b) per-row / suite running signals come from `anyRunning(recent_runs)` and the
   skill-scoped `useRunningSkillCaseIds()` (never `last_run`, never `isPending`);
   (c) each case's latest result can be expanded to show the DELTA findings it
   added (caught/noise/ignored). Null metrics render "—" (AC-14). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Icon, Badge, EmptyState, Skeleton } from "@devdigest/ui";
import type { Skill, EvalCaseListItem, EvalSkillCaseDelta } from "@devdigest/shared";
import {
  anyRunning,
  useSkillEvalCases,
  useSkillEvalDashboard,
  useSkillEvalSuite,
  useRunSkillEvals,
  useRunSkillCase,
  useRunningSkillCaseIds,
  useDeleteEvalCase,
} from "@/lib/hooks/eval";
import { CaseEditor } from "@/components/eval/CaseEditor";
import { HostAgentPicker } from "@/components/eval/HostAgentPicker";
import { DeltaFindings } from "@/components/eval/DeltaFindings";
import { fmtPct } from "@/components/eval/helpers";

type EditState = { mode: "new" } | { mode: "edit"; item: EvalCaseListItem } | null;

export function EvalsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("eval");
  const router = useRouter();
  const qc = useQueryClient();
  const { data: dash } = useSkillEvalDashboard(skill.id);
  // A skill suite is fire-and-forget on the server: the POST returns immediately,
  // so the REAL busy signal is a `running` suite in the polled dashboard's
  // recent_runs, never a `last_run` field (client/INSIGHTS 2026-07-11).
  const suiteRunning = anyRunning(dash?.recent_runs);
  const { data: cases, isLoading } = useSkillEvalCases(skill.id, suiteRunning);
  const runAll = useRunSkillEvals(skill.id);
  const runCase = useRunSkillCase(skill.id);
  const runningCaseIds = useRunningSkillCaseIds();
  const del = useDeleteEvalCase({ kind: "skill", id: skill.id, name: skill.name });

  const [host, setHost] = React.useState<string | null>(null);
  const [edit, setEdit] = React.useState<EditState>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  // The delta a run added is persisted in `eval_runs.actual_output`; surface it
  // per case by reading the most recent skill suite's per-case rows. A single-case
  // run outside a suite has no suite row → its delta is simply unavailable (the
  // DeltaFindings empty copy covers that).
  const latestSuiteId = (dash?.recent_runs ?? [])[0]?.id ?? null;
  const { data: suiteDetail } = useSkillEvalSuite(latestSuiteId);
  const deltaByCase = React.useMemo(() => {
    const m = new Map<string, EvalSkillCaseDelta>();
    for (const r of suiteDetail?.runs ?? []) {
      if (r.actual_output) m.set(r.case_id, r.actual_output as EvalSkillCaseDelta);
    }
    return m;
  }, [suiteDetail]);

  // Per-case rows are persisted BEFORE the suite turns terminal, but the last
  // cases poll may predate the final rows — refetch once on the running→terminal
  // edge (prevRunningRef pattern, client/INSIGHTS 2026-06-24).
  const prevRunningRef = React.useRef(false);
  React.useEffect(() => {
    if (prevRunningRef.current && !suiteRunning) {
      void qc.invalidateQueries({ queryKey: ["skill-eval-cases", skill.id] });
    }
    prevRunningRef.current = suiteRunning;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- edge detector on the single running signal; qc/skill.id are stable for a mounted tab
  }, [suiteRunning]);

  const current = dash?.current;
  // The server's `current` block is the newest COMPLETED suite run — surface which
  // one, so it is visible that single-case runs don't move these tiles.
  const lastSuite = (dash?.recent_runs ?? []).find((r) => r.status === "done");
  const passed = (cases ?? []).filter((c) => c.latest?.pass === true).length;
  const total = cases?.length ?? 0;

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      {/* metric summary tiles */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{t("evalsTab.metricsTitle")}</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("hostPicker.hint")}</div>
        </div>
        <Button
          kind="ghost"
          size="sm"
          onClick={() => router.push(`/eval?tab=skills&skill=${skill.id}`)}
        >
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
            version: lastSuite.skill_version,
            date: new Date(lastSuite.ran_at).toLocaleString(),
          })}
        </div>
      )}

      {/* cases header + controls */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 15, fontWeight: 700, alignSelf: "center" }}>{t("evalsTab.casesHeading")}</span>
        <Badge color="var(--text-secondary)">{t("evalsTab.casesCount", { passed, total })}</Badge>
        <div style={{ flex: 1 }} aria-hidden />
        <HostAgentPicker skillId={skill.id} value={host} onChange={setHost} disabled={suiteRunning} />
        <Button
          kind="secondary"
          size="sm"
          icon="Play"
          loading={runAll.isPending || suiteRunning}
          disabled={total === 0 || !host}
          onClick={() => host && runAll.mutate(host)}
        >
          {suiteRunning ? t("evalsTab.running") : t("hostPicker.runOnEvals")}
        </Button>
        <Button kind="primary" size="sm" icon="Plus" onClick={() => setEdit({ mode: "new" })}>
          {t("caseEditor.newCase")}
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
              runDisabled={!host}
              expanded={expanded === c.id}
              delta={deltaByCase.get(c.id)}
              onRun={() => host && runCase.mutate({ caseId: c.id, hostAgentId: host })}
              onToggle={() => setExpanded((e) => (e === c.id ? null : c.id))}
              onEdit={() => setEdit({ mode: "edit", item: c })}
              onDelete={() => del.mutate(c.id)}
            />
          ))}
        </div>
      )}

      {edit && (
        <CaseEditor
          owner={{ kind: "skill", id: skill.id, name: skill.name }}
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
  runDisabled,
  expanded,
  delta,
  onRun,
  onToggle,
  onEdit,
  onDelete,
}: {
  item: EvalCaseListItem;
  runPending: boolean;
  runDisabled: boolean;
  expanded: boolean;
  delta: EvalSkillCaseDelta | undefined;
  onRun: () => void;
  onToggle: () => void;
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
  const canExpand = item.latest != null;
  const ExpandIcon = expanded ? Icon.ChevronDown : Icon.ChevronRight;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg-surface)" }}>
        {canExpand ? (
          <Button
            kind="ghost"
            size="sm"
            onClick={onToggle}
            aria-label={t("delta.heading")}
            aria-expanded={expanded}
          >
            <ExpandIcon size={15} />
          </Button>
        ) : (
          <span style={{ width: 28 }} aria-hidden />
        )}
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
        <Button kind="ghost" size="sm" icon="Play" loading={runPending} disabled={runDisabled} onClick={onRun} aria-label={t("evalsTab.run")}>
          {t("evalsTab.run")}
        </Button>
        <Button kind="ghost" size="sm" icon="Edit" onClick={onEdit} aria-label={t("evalsTab.edit")}>
          {t("evalsTab.edit")}
        </Button>
        <Button kind="ghost" size="sm" icon="Trash" onClick={onDelete} aria-label={t("evalsTab.delete")}>
          {t("evalsTab.delete")}
        </Button>
      </div>
      {expanded && (
        <div style={{ paddingLeft: 40 }}>
          <DeltaFindings delta={delta} />
        </div>
      )}
    </div>
  );
}
