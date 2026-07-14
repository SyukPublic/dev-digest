/* TabsView — the per-agent tabbed results layout. A tab per agent column; the
   active tab shows a summary banner + that agent's findings as expandable detail
   cards (confidence, suggested fix, actions, lethal-trifecta). The column subset
   (AgentColumnFinding) lacks the detail fields, so the FULL findings come from
   usePrReviews(prId) joined by run_id. Accept/Dismiss go through useFindingAction;
   "Turn into eval case" reuses the CaseEditor (create-on-save, no caseId). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { CircularScore, Icon, MonoLink, Tabs } from "@devdigest/ui";
import type { AgentColumn, EvalCaseDraft, FindingRecord, MultiAgentRun } from "@devdigest/shared";
import { usePrReviews, useFindingAction } from "@/lib/hooks/reviews";
import { useEvalCaseDraftFromFinding } from "@/lib/hooks/eval";
import { CaseEditor } from "@/components/eval/CaseEditor";
import { RunCostBadge } from "@/components/run-cost-badge";
import { useToast } from "@/lib/toast";
import { durationLabel, scoreColor } from "../../helpers";
import { FindingDetailCard } from "./FindingDetailCard";
import { s } from "./styles";

export function TabsView({
  run,
  prId,
  onOpenTrace,
}: {
  run: MultiAgentRun;
  prId: string;
  onOpenTrace: (col: AgentColumn) => void;
}) {
  const t = useTranslations("runs");
  const toast = useToast();
  const { data: reviews } = usePrReviews(prId);
  const action = useFindingAction();
  const evalCaseDraft = useEvalCaseDraftFromFinding();
  const [editingDraft, setEditingDraft] = React.useState<EvalCaseDraft | null>(null);

  const [activeRunId, setActiveRunId] = React.useState<string>(() => run.columns[0]?.run_id ?? "");
  const active = run.columns.find((c) => c.run_id === activeRunId) ?? run.columns[0];

  // The FULL findings for the active agent's run (detail fields the column subset
  // omits: confidence, suggestion, trifecta_components).
  const findings: FindingRecord[] = React.useMemo(() => {
    if (!active) return [];
    return (reviews ?? [])
      .filter((r) => r.run_id === active.run_id)
      .flatMap((r) => r.findings);
  }, [reviews, active]);

  const turnIntoEvalCase = React.useCallback(
    (findingId: string) => {
      evalCaseDraft.mutate(findingId, {
        onSuccess: (draft) => setEditingDraft(draft),
        onError: () => toast.error(t("tabs.turnIntoEvalCase")),
      });
    },
    [evalCaseDraft, toast, t],
  );

  if (!active) return null;

  const tabs = run.columns.map((c) => ({
    key: c.run_id,
    label: c.agent_name,
    count: c.score ?? undefined,
  }));

  return (
    <div>
      <Tabs tabs={tabs} value={active.run_id} onChange={setActiveRunId} pad="0" />

      <div style={s.banner(scoreColor(active.score))}>
        <div style={s.bannerMain}>
          <Icon.Users size={16} style={{ color: "var(--text-muted)" }} />
          <span style={s.bannerName}>{active.agent_name}</span>
          <span style={s.bannerSummary}>{active.summary ?? t("tabs.noSummary")}</span>
        </div>
        <div style={s.bannerRight}>
          <MonoLink onClick={() => onOpenTrace(active)}>{t("viewTrace")}</MonoLink>
          <span className="mono" style={s.bannerMeta}>
            {durationLabel(active.duration_ms)}
          </span>
          <RunCostBadge costUsd={active.cost_usd} />
          {active.score != null && <CircularScore score={active.score} size={38} />}
        </div>
      </div>

      <div style={s.findings}>
        {findings.length === 0 ? (
          <div style={s.empty}>{t("tabs.empty")}</div>
        ) : (
          findings.map((f) => (
            <FindingDetailCard
              key={f.id}
              f={f}
              pending={action.isPending}
              evalCasePending={evalCaseDraft.isPending}
              onAccept={() => action.mutate({ findingId: f.id, action: "accept", prId })}
              onDismiss={() => action.mutate({ findingId: f.id, action: "dismiss", prId })}
              onLearn={() => {}}
              onTurnIntoEvalCase={() => turnIntoEvalCase(f.id)}
            />
          ))
        )}
      </div>

      {editingDraft && (
        <CaseEditor
          agent={{ id: editingDraft.agent_id, name: editingDraft.agent_name }}
          initialDraft={editingDraft}
          onSaved={() => toast.success(t("tabs.turnIntoEvalCase"))}
          onClose={() => setEditingDraft(null)}
        />
      )}
    </div>
  );
}
