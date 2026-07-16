/* AgentPicker — L07 multi-agent launch control (replaces RunReviewDropdown).
   A checkbox per workspace agent with a per-agent history-based time/cost
   orientation, a "Run multi-agent review (N)" primary action (disabled at 0),
   and a "Configure agents…" footer. On launch it POSTs the selected agent ids
   via useLaunchMultiAgentRun, then routes to the multi-agent results page.

   Merged/closed PRs are dimmed + warned, but the run is still permitted. */
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Icon, Checkbox, SectionLabel } from "@devdigest/ui";
import { RunCostBadge } from "@/components/run-cost-badge";
import { useAgents } from "@/lib/hooks/agents";
import { useAgentEstimates, useLaunchMultiAgentRun } from "@/lib/hooks/multi-agent";
import { useToast } from "@/lib/toast";
import type { AgentEstimate } from "@devdigest/shared";
import { s } from "./styles";

/** Compact seconds orientation from a duration in ms, e.g. "~6s" / "~8.2s". */
function formatDurationSecs(ms: number): string {
  const secs = ms / 1000;
  return `~${Number.isInteger(secs) ? secs : secs.toFixed(1)}s`;
}

export function AgentPicker({
  prId,
  warnMerged = false,
  onRunStart,
}: {
  prId: string;
  /** PR is already merged/closed — dim the trigger and warn, but still allow. */
  warnMerged?: boolean;
  /** Fired the moment a launch is kicked off (before navigation). */
  onRunStart?: () => void;
}) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const params = useParams<{ repoId: string }>();
  const repoId = params?.repoId;
  const toast = useToast();

  const { data: agents } = useAgents();
  const { data: estimates } = useAgentEstimates();
  const launch = useLaunchMultiAgentRun();

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click — only while open (no idle global listener).
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  const all = (agents ?? []).filter((a) => a.enabled);
  const estimateById = useMemo(() => {
    const m = new Map<string, AgentEstimate>();
    for (const e of estimates ?? []) m.set(e.agent_id, e);
    return m;
  }, [estimates]);

  const count = selected.size;

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const goToAgents = useCallback(() => router.push("/agents"), [router]);

  const handleLaunch = useCallback(async () => {
    if (count === 0 || launch.isPending) return;
    onRunStart?.();
    try {
      await launch.mutateAsync({ prId, agentIds: [...selected] });
      setOpen(false);
      router.push(`/repos/${repoId}/multi-agent?pr=${prId}`);
    } catch {
      toast.error(t("agentPicker.launchFailed"));
    }
  }, [count, launch, onRunStart, prId, selected, router, repoId, toast, t]);

  return (
    <div ref={ref} style={s.root}>
      <span
        title={warnMerged ? t("runReview.mergedTooltip") : undefined}
        style={warnMerged ? { opacity: 0.6 } : undefined}
      >
        <Button
          kind="primary"
          size="sm"
          icon="Sparkles"
          iconRight="ChevronDown"
          loading={launch.isPending}
          onClick={() => setOpen((o) => !o)}
        >
          {launch.isPending ? t("runReview.running") : t("runReview.runReview")}
        </Button>
      </span>

      {open && (
        <div style={s.panel}>
          <SectionLabel
            icon="Sparkles"
            right={
              count > 0 ? (
                <button type="button" style={s.clearBtn} onClick={clear}>
                  {t("agentPicker.clear")}
                </button>
              ) : undefined
            }
          >
            {t("agentPicker.heading")}
          </SectionLabel>

          {warnMerged && (
            <div style={s.mergedRow}>
              <Icon.AlertTriangle size={13} style={{ color: "var(--warn)", flexShrink: 0 }} />
              <span>{t("runReview.mergedWarning")}</span>
            </div>
          )}

          {all.length === 0 ? (
            <div style={s.empty}>{t("agentPicker.noAgents")}</div>
          ) : (
            <div style={s.list}>
              {all.map((a) => {
                const est = estimateById.get(a.id);
                const hasHistory = est != null && est.sample_size > 0;
                return (
                  <div key={a.id} style={s.agentRow}>
                    <Checkbox
                      checked={selected.has(a.id)}
                      onChange={() => toggle(a.id)}
                      label={a.name}
                    />
                    {hasHistory ? (
                      <span className="mono" style={s.orientation}>
                        {est.avg_duration_ms != null && (
                          <span>{formatDurationSecs(est.avg_duration_ms)}</span>
                        )}
                        <RunCostBadge costUsd={est.avg_cost_usd} />
                      </span>
                    ) : (
                      <span style={s.fallback}>{t("agentPicker.noHistory")}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div style={s.runBtnWrap}>
            <Button
              kind="primary"
              size="sm"
              icon="Play"
              full
              disabled={count === 0}
              loading={launch.isPending}
              onClick={handleLaunch}
            >
              {t("agentPicker.run", { count })}
            </Button>
          </div>

          <div style={s.footer}>
            <button type="button" style={s.footerLink} onClick={goToAgents}>
              <Icon.Settings size={13} />
              {t("runReview.configureAgents")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
