"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, CircularScore, type IconName } from "@devdigest/ui";
import type { RunSummary, FindingRecord } from "@devdigest/shared";
import { RunCostBadge } from "@/components/run-cost-badge";
import { countBySeverity } from "@/components/findings/helpers";
import { SeverityCountBadges } from "@/components/findings/SeverityCountBadges";

type Outcome = { key: string; color: string; bg: string; icon: IconName };

/**
 * The badge reflects the review OUTCOME, not just the run lifecycle: a finished
 * run that found blockers reads "rejected" (red), never a green "done". Outcome
 * is derived from the denormalized blocker/finding counts on the run row, so it
 * matches the CI gate (deterministic) rather than the model's verdict.
 */
function outcomeOf(run: RunSummary): Outcome {
  const status = run.status ?? "";
  if (status === "running")
    return { key: "running", color: "var(--accent)", bg: "var(--accent-bg)", icon: "RefreshCw" };
  if (status === "failed")
    return { key: "error", color: "var(--crit)", bg: "var(--crit-bg)", icon: "XCircle" };
  if (status === "cancelled")
    return { key: "cancelled", color: "var(--text-muted)", bg: "var(--bg-hover)", icon: "X" };
  // Settled ("done"): color by the deterministic outcome.
  if ((run.blockers ?? 0) > 0)
    return { key: "rejected", color: "var(--crit)", bg: "var(--crit-bg)", icon: "XCircle" };
  if ((run.findings_count ?? 0) > 0)
    return { key: "reviewed", color: "var(--warn)", bg: "var(--warn-bg)", icon: "MessageSquare" };
  return { key: "approved", color: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle" };
}

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  width: "100%",
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg-elevated)",
  textAlign: "left",
};

const iconBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 4,
  borderRadius: 5,
  border: "1px solid var(--border)",
  background: "var(--bg-surface)",
  color: "var(--text-muted)",
  cursor: "pointer",
  flexShrink: 0,
};

/** One agent run in the PR timeline (badge, score, findings, cost, actions). */
export function RunRow({
  run,
  findings,
  onOpenTrace,
  onGoToReview,
  onDelete,
  onOpenFindings,
}: {
  run: RunSummary;
  /** This run's non-dismissed findings — drives the severity-count popover trigger. */
  findings: FindingRecord[];
  onOpenTrace: (runId: string) => void;
  onGoToReview?: (runId: string) => void;
  onDelete?: (runId: string) => void;
  /** Toggle the findings popover for this run, anchored to the clicked badge. */
  onOpenFindings: (runId: string, anchor: DOMRect) => void;
}) {
  const t = useTranslations("prReview");
  const r = run;
  const o = outcomeOf(r);
  const settled = r.status === "done";
  const runCounts = countBySeverity(findings);
  const findingsLabel =
    t("runStatus.findings", { count: r.findings_count ?? 0 }) +
    ((r.blockers ?? 0) > 0 ? t("runStatus.blockers", { count: r.blockers ?? 0 }) : "");

  return (
    <div style={rowStyle}>
      <Badge color={o.color} bg={o.bg} icon={o.icon}>
        {t(`runStatus.${o.key}`)}
      </Badge>
      {settled && r.score != null && <CircularScore score={r.score} size={30} stroke={3} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
          <button
            type="button"
            onClick={() => onGoToReview?.(r.run_id)}
            title={t("timeline.goToReview")}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              font: "inherit",
              fontWeight: 600,
              color: "var(--text-primary)",
              cursor: onGoToReview ? "pointer" : "default",
              textDecoration: onGoToReview ? "underline" : "none",
              textDecorationStyle: "dotted",
              textUnderlineOffset: 3,
            }}
          >
            {r.agent_name ?? "Agent"}
          </button>{" "}
          <span className="mono" style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>
            {r.provider}/{r.model}
          </span>
        </div>
        {r.status === "failed" && r.error && (
          <div
            style={{ fontSize: 12, color: "var(--crit)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            title={r.error}
          >
            {r.error}
          </div>
        )}
        {settled &&
          (findings.length > 0 ? (
            <button
              type="button"
              title={t("timeline.viewFindings")}
              onClick={(e) => {
                e.stopPropagation();
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                onOpenFindings(r.run_id, rect);
              }}
              style={{
                width: "fit-content",
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
              }}
            >
              <SeverityCountBadges counts={runCounts} />
            </button>
          ) : (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{findingsLabel}</div>
          ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
        {r.ran_at && <span>{new Date(r.ran_at).toLocaleTimeString()}</span>}
        {settled && (
          <RunCostBadge costUsd={r.cost_usd} tokensIn={r.tokens_in} tokensOut={r.tokens_out} variant="withTokens" />
        )}
      </div>
      <button
        type="button"
        title={t("timeline.openTrace")}
        aria-label={t("timeline.openTrace")}
        onClick={() => onOpenTrace(r.run_id)}
        style={iconBtnStyle}
      >
        <Icon.FileText size={13} />
      </button>
      {onDelete && r.status !== "running" && (
        <span
          role="button"
          aria-label={t("timeline.deleteRun")}
          title={t("timeline.deleteRun")}
          onClick={() => onDelete(r.run_id)}
          style={{ display: "inline-flex", padding: 3, borderRadius: 5, color: "var(--text-muted)", flexShrink: 0, cursor: "pointer" }}
        >
          <Icon.Trash size={13} />
        </span>
      )}
    </div>
  );
}
