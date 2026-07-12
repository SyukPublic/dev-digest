/* FindingsPanel — hide-low-confidence + j/k navigation + FindingCard list,
   wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState, SeverityFilter, SEVERITY_LEVELS } from "@devdigest/ui";
import type { FindingRecord, Severity, EvalCaseDraft } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { CaseEditor } from "@/components/eval/CaseEditor";
import { useFindingAction } from "@/lib/hooks/reviews";
import { useEvalCaseDraftFromFinding } from "@/lib/hooks/eval";
import { useToast } from "@/lib/toast";
import { countBySeverity, visibleFindings } from "@/components/findings/helpers";
import { KEY_TO_ACTION } from "./constants";
import { s } from "./styles";

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const toast = useToast();
  const evalCaseDraft = useEvalCaseDraftFromFinding();
  // The finding-derived draft currently open in the Case Editor (null = closed).
  const [editingDraft, setEditingDraft] = React.useState<EvalCaseDraft | null>(null);
  const [hideLow, setHideLow] = React.useState(false);

  // "Turn into eval case": derive the draft server-side (agent/diff/meta/expected),
  // then open the Case Editor on it — Save creates the case; Cancel creates nothing.
  const turnIntoEvalCase = React.useCallback(
    (findingId: string) => {
      evalCaseDraft.mutate(findingId, {
        onSuccess: (draft) => setEditingDraft(draft),
        onError: () => toast.error(t("finding.evalCaseFailed")),
      });
    },
    [evalCaseDraft, toast, t],
  );
  const [focusIdx, setFocusIdx] = React.useState(0);
  // Severity filter — all levels on by default; clicking a chip toggles it.
  const [activeSev, setActiveSev] = React.useState<Set<Severity>>(() => new Set(SEVERITY_LEVELS));
  const toggleSev = React.useCallback((sev: Severity) => {
    setActiveSev((prev) => {
      const next = new Set(prev);
      if (next.has(sev)) next.delete(sev);
      else next.add(sev);
      return next;
    });
  }, []);

  const counts = React.useMemo(() => countBySeverity(findings), [findings]);
  const shown = React.useMemo(
    () => visibleFindings(findings, hideLow, activeSev),
    [findings, hideLow, activeSev],
  );

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) {
        action.mutate({ findingId: shown[focusIdx]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focusIdx, action, prId]);

  return (
    <div>
      <div style={s.toolbar}>
        <SeverityFilter counts={counts} active={activeSev} onToggle={toggleSev} />
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focusIdx}
              defaultExpanded={i === 0}
              pending={action.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
              onTurnIntoEvalCase={() => turnIntoEvalCase(f.id)}
              evalCasePending={evalCaseDraft.isPending}
            />
          ))
        )}
      </div>

      {editingDraft && (
        <CaseEditor
          agent={{ id: editingDraft.agent_id, name: editingDraft.agent_name }}
          initialDraft={editingDraft}
          onSaved={() => toast.success(t("finding.evalCaseCreated"))}
          onClose={() => setEditingDraft(null)}
        />
      )}
    </div>
  );
}
