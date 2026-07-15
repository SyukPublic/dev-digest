/* ConfigureRun — the Configure-run mode of the Multi-Agent Review page.
   Step 1 pick a PR, Step 2 toggle any subset of the workspace agents, with a
   per-agent history estimate + a summed (Σ cost, MAX duration) parallel estimate,
   then "Run multi-agent review (N)". Data comes from hooks (usePulls / useAgents /
   useAgentEstimates / useLaunchMultiAgentRun); this component only renders +
   composes the client-side estimate. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Card, Checkbox, EmptyState, Icon, SelectInput, Skeleton } from "@devdigest/ui";
import type { AgentEstimate } from "@devdigest/shared";
import { usePulls } from "@/lib/hooks/core";
import { useAgents } from "@/lib/hooks/agents";
import { useAgentEstimates, useLaunchMultiAgentRun } from "@/lib/hooks/multi-agent";
import { useToast } from "@/lib/toast";
import { formatCost } from "@/lib/format";
import { composeEstimate, durationLabel } from "../../helpers";
import { s } from "./styles";

export function ConfigureRun({
  repoId,
  prId,
  initialAgentIds,
  onSelectPr,
  onLaunched,
}: {
  repoId: string;
  prId: string | null;
  /** Agent ids of the PR's existing multi-run — pre-checked on open, ∩ enabled (Fix 2). */
  initialAgentIds?: readonly string[];
  onSelectPr: (prId: string | null) => void;
  onLaunched: (prId: string) => void;
}) {
  const t = useTranslations("runs");
  const toast = useToast();
  const { data: pulls, isLoading: pullsLoading } = usePulls(repoId);
  const { data: agents } = useAgents();
  const { data: estimates } = useAgentEstimates();
  const launch = useLaunchMultiAgentRun();

  // Exactly the workspace agents that are enabled — no seeded personas (AC-4).
  const enabledAgents = React.useMemo(() => (agents ?? []).filter((a) => a.enabled), [agents]);
  const estimateById = React.useMemo(() => {
    const m = new Map<string, AgentEstimate>();
    for (const e of estimates ?? []) m.set(e.agent_id, e);
    return m;
  }, [estimates]);

  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const toggle = React.useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Restore the run's selection (Fix 2), render-phase — no props→state useEffect.
  // A PR change resets the (stale) selection; then, once `agents` is loaded, the run's
  // agent ids are seeded exactly once, intersected with the enabled set.
  const [latch, setLatch] = React.useState<{ prId: string | null; seeded: boolean }>({
    prId,
    seeded: false,
  });
  if (latch.prId !== prId) {
    setLatch({ prId, seeded: false });
    setSelected(new Set());
  } else if (!latch.seeded && agents != null) {
    const enabledIds = new Set(enabledAgents.map((a) => a.id));
    setSelected(new Set((initialAgentIds ?? []).filter((id) => enabledIds.has(id))));
    setLatch({ prId, seeded: true });
  }
  const allSelected = enabledAgents.length > 0 && selected.size === enabledAgents.length;
  const selectAll = () =>
    setSelected(allSelected ? new Set() : new Set(enabledAgents.map((a) => a.id)));

  // Summed estimate over the currently-selected agents (AC-7).
  const summed = React.useMemo(
    () =>
      composeEstimate(
        [...selected]
          .map((id) => estimateById.get(id))
          .filter((e): e is AgentEstimate => e != null),
      ),
    [selected, estimateById],
  );

  const count = selected.size;
  const canRun = count > 0 && prId != null && !launch.isPending;
  const run = () => {
    if (!canRun || prId == null) return;
    launch.mutate(
      { prId, agentIds: [...selected] },
      {
        onSuccess: () => onLaunched(prId),
        onError: () => toast.error(t("page.noRun.title")),
      },
    );
  };

  const prOptions = React.useMemo(
    () => [
      { value: "", label: t("page.selectPrPlaceholder") },
      ...(pulls ?? []).map((p) => ({
        value: p.id ?? String(p.number),
        label: t("page.prItem", { number: p.number, title: p.title }),
      })),
    ],
    [pulls, t],
  );

  return (
    <div style={s.wrap}>
      <div>
        <h1 style={s.h1}>{t("page.configureTitle")}</h1>
        <p style={s.subtitle}>{t("page.configureSubtitle")}</p>
      </div>

      {/* Step 1 — pick a PR */}
      <section>
        <div style={s.stepHead}>
          <span style={s.stepBadge}>1</span>
          <span style={s.stepLabel}>{t("page.step1")}</span>
        </div>
        {pullsLoading ? (
          <Skeleton height={42} />
        ) : (
          <SelectInput value={prId ?? ""} onChange={(v) => onSelectPr(v || null)} options={prOptions} />
        )}
      </section>

      {/* Step 2 — pick reviewers */}
      <section>
        <div style={s.stepHead}>
          <span style={s.stepBadge}>2</span>
          <span style={s.stepLabel}>{t("page.step2")}</span>
          {prId != null && enabledAgents.length > 0 && (
            <button type="button" style={s.selectAll} onClick={selectAll}>
              {t("page.selectAll")}
            </button>
          )}
        </div>

        {prId == null ? (
          <Card>
            <div style={s.placeholder}>
              <div style={s.placeholderTitle}>{t("page.pickPrFirst.title")}</div>
              <div style={s.placeholderBody}>{t("page.pickPrFirst.body")}</div>
            </div>
          </Card>
        ) : enabledAgents.length === 0 ? (
          <EmptyState icon="Users" title={t("page.noAgents.title")} body={t("page.noAgents.body")} />
        ) : (
          <div style={s.agentList}>
            {enabledAgents.map((a) => {
              const est = estimateById.get(a.id);
              const checked = selected.has(a.id);
              return (
                <Card key={a.id} style={s.agentCard}>
                  <div style={s.agentMain}>
                    <Checkbox checked={checked} onChange={() => toggle(a.id)} label={a.name} />
                    <Icon.Users size={16} style={{ color: "var(--text-muted)" }} />
                  </div>
                  <span className="mono" style={s.agentEstimate}>
                    {t("page.estimate.perAgent", {
                      duration: durationLabel(est?.avg_duration_ms),
                      cost: formatCost(est?.avg_cost_usd),
                    })}
                  </span>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Launch */}
      <div style={s.launchRow}>
        <Button kind="primary" icon="Play" disabled={!canRun} loading={launch.isPending} onClick={run}>
          {t("page.run", { count })}
        </Button>
        {count > 0 && (
          <span style={s.summed}>
            {t("page.estimate.summed", {
              duration: durationLabel(summed.durationMs),
              cost: formatCost(summed.costUsd),
            })}
          </span>
        )}
      </div>
    </div>
  );
}
