/* PrBriefCard — the "PR BRIEF" block at the top of the Overview tab.

   HEADER is COMPOSED from the latest review + its run (CP-8) with ZERO extra LLM /
   ZERO extra fetch (both queries are already on the PR page): verdict badge, a
   "N findings · M blockers" pill, a PR SCORE gauge, and a cost line. Every header
   field renders "—" when there is no review (AC-7).

   BODY renders the brief's `what`/`why` prose (via `Markdown`, model text as DATA)
   plus a colour-coded `risk_level` badge and an info affordance (AC-6). When no
   brief is stored, an empty "Generate brief" body — opening the page makes NO LLM
   call (AC-8). A Regenerate button spends the only LLM call (AC-9), disabled while
   pending with a progress affordance + aria-live announcement (AC-10, AC-18). The
   Outdated badge (icon + text) shows when `is_stale` (AC-14). Loading → Skeleton
   (AC-15); a generate failure surfaces non-blocking (AC-13).

   SECURITY: all model-derived strings (what/why, verdict) are rendered as TEXT /
   Markdown-as-data — no dangerouslySetInnerHTML (AC-21). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Card,
  SectionLabel,
  Badge,
  Button,
  Icon,
  Markdown,
  CircularScore,
  CollapsibleCard,
  Skeleton,
  type IconName,
} from "@devdigest/ui";
import type { ReviewRecord, RunSummary, Verdict, RiskSeverity } from "@devdigest/shared";
import { useBrief, useRegenerateBrief } from "@/lib/hooks/brief";
import { usePrReviews, usePrRuns } from "@/lib/hooks/reviews";
import { formatCost, formatTokensTotal } from "@/lib/format";

interface PrBriefCardProps {
  prId: string;
}

const EM_DASH = "—";

/* Visually hidden, read by assistive tech (verbatim from IntentCard's srOnly so
   the aria-live status region + score text-equivalent are in the DOM but invisible
   to sighted users). */
const srOnly: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

/* Verdict → color + icon (state is conveyed by icon + text, never color alone —
   WCAG). Uses theme CSS vars verified present in styles.css. */
const VERDICT_META: Record<Verdict, { color: string; icon: IconName }> = {
  request_changes: { color: "var(--crit)", icon: "XCircle" },
  approve: { color: "var(--ok)", icon: "CheckCircle" },
  comment: { color: "var(--text-secondary)", icon: "MessageSquare" },
};

/* risk_level → color/bg + icon. Mirrors IntentCard's RISK_SEV (high=crit/red,
   medium=warn/amber, low=muted); state carries a textual label too (never color
   alone). */
const RISK_META: Record<RiskSeverity, { color: string; bg: string; icon: IconName }> = {
  high: { color: "var(--crit)", bg: "var(--crit-bg)", icon: "AlertTriangle" },
  medium: { color: "var(--warn)", bg: "var(--warn-bg)", icon: "AlertTriangle" },
  low: { color: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle" },
};

export function PrBriefCard({ prId }: PrBriefCardProps) {
  const t = useTranslations("brief");
  const { data: brief, isLoading: briefLoading } = useBrief(prId);
  // CP-8: header composed from data already on the PR page — no extra LLM/fetch.
  const { data: reviews } = usePrReviews(prId);
  const { data: runs } = usePrRuns(prId);
  const regenerate = useRegenerateBrief();

  // The latest actual review (kind === 'review', NOT a summary row; NOT [0] which
  // may be a summary). Derive; don't store.
  const latestReview = React.useMemo(
    () => (reviews ?? []).find((r) => r.kind === "review") ?? null,
    [reviews],
  );
  // The run that produced that review — the only source of cost/tokens (the
  // ReviewRecord carries neither; server INSIGHTS 2026-06-19/06-20).
  const run = React.useMemo(
    () =>
      latestReview?.run_id != null
        ? (runs ?? []).find((r) => r.run_id === latestReview.run_id) ?? null
        : null,
    [runs, latestReview],
  );

  const handleRegenerate = React.useCallback(() => {
    regenerate.mutate(prId);
  }, [regenerate, prId]);

  // aria-live announcement derived from the mutation lifecycle (derive, don't
  // store): pending → "Generating…", errored → failure, success → done (AC-18).
  const announceText = regenerate.isPending
    ? t("generating")
    : regenerate.isError
      ? t("generateFailed")
      : regenerate.isSuccess
        ? t("briefUpdated")
        : "";

  const isStale = !!brief?.is_stale;

  /* Outdated badge — rendered only when `is_stale`. Badge has no `title` prop, so
     wrap in a span carrying the native hover tooltip (same pattern as IntentCard).
     State by icon + textual label, never color alone (WCAG). The tooltip notes
     that issue/spec edits are NOT auto-flagged — Regenerate refreshes (AC-14). */
  const outdatedBadge = isStale ? (
    <span title={t("outdatedTooltip")}>
      <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
        {t("outdated")}
      </Badge>
    </span>
  ) : null;

  return (
    <section>
      <SectionLabel icon="FileText">{t("prBrief.title")}</SectionLabel>
      <Card>
        <BriefHeader
          latestReview={latestReview}
          run={run}
          outdatedBadge={outdatedBadge}
          isRegenerating={regenerate.isPending}
          onRegenerate={handleRegenerate}
          // The header owns the single generate/regenerate control (next to the
          // Score gauge): a labeled "Regenerate brief" Button once a brief exists
          // (R5.2), or the "Generate brief" CTA in that same slot when none does
          // (R5.3). The empty-state body keeps ONLY its explanatory text — no
          // duplicate control (AC-12). While the brief query is still loading,
          // neither is shown yet.
          hasBrief={!briefLoading && !!brief}
          showControl={!briefLoading}
        />

        {/* Non-blocking generate error — surfaces inline above the body, never
            replaces the composed header (AC-13). */}
        {regenerate.isError && (
          <div
            role="alert"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 12,
              fontSize: 13,
              color: "var(--crit)",
            }}
          >
            <Icon.AlertTriangle size={14} />
            {t("generateFailed")}
          </div>
        )}

        {/* Body: loading → skeleton (AC-15); no brief → Generate empty state
            (AC-8); otherwise the what/why prose + risk_level badge + info (AC-6). */}
        <div style={{ marginTop: 16 }}>
          {briefLoading ? (
            <BriefBodySkeleton />
          ) : brief ? (
            <BriefBody
              what={brief.what}
              why={brief.why}
              riskLevel={brief.risk_level}
            />
          ) : (
            <BriefEmptyBody />
          )}
        </div>

        {/* Combined visually-hidden aria-live region for Regenerate/Generate +
            Outdated transitions (AC-18). */}
        <div role="status" aria-live="polite" aria-atomic="true" style={srOnly}>
          {announceText}
        </div>
      </Card>
    </section>
  );
}

// ---- Header (composed from latest review + its run, CP-8) ----

function BriefHeader({
  latestReview,
  run,
  outdatedBadge,
  isRegenerating,
  onRegenerate,
  hasBrief,
  showControl,
}: {
  latestReview: ReviewRecord | null;
  run: RunSummary | null;
  outdatedBadge: React.ReactNode;
  isRegenerating: boolean;
  onRegenerate: () => void;
  /** True once a brief exists → the header shows the labeled Regenerate Button;
   *  false → it shows the Generate CTA in the same slot (R5.2/R5.3). */
  hasBrief: boolean;
  /** Gate both header controls off while the brief query is still loading. */
  showControl: boolean;
}) {
  const t = useTranslations("brief");

  const verdict = latestReview?.verdict ?? null;
  const score = latestReview?.score ?? null;
  const findingsCount = latestReview ? latestReview.findings.length : null;
  const blockersCount = latestReview
    ? latestReview.findings.filter((f) => f.severity === "CRITICAL").length
    : null;

  const verdictMeta = verdict ? VERDICT_META[verdict] : null;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
      }}
    >
      {/* Left cluster: verdict + findings/blockers pill + info affordance. */}
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        {verdictMeta ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 15,
              fontWeight: 700,
              color: verdictMeta.color,
            }}
          >
            {React.createElement(Icon[verdictMeta.icon], { size: 18 })}
            {t(`verdict.${verdict}`)}
          </span>
        ) : (
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-muted)" }}>
            {EM_DASH}
          </span>
        )}

        {/* N findings · M blockers pill — "—" when no review (AC-7). */}
        <Badge color="var(--text-secondary)" bg="var(--bg-hover)">
          {findingsCount != null && blockersCount != null
            ? t("findingsBlockers", { findings: findingsCount, blockers: blockersCount })
            : EM_DASH}
        </Badge>

        {/* Info affordance — keyboard-operable expander explaining the composed
            brief. CollapsibleCard toggles aria-expanded on Enter/Space (AC-6). */}
        <BriefInfo />
      </div>

      {/* Right cluster: the single generate/regenerate control + PR SCORE gauge +
          cost line + Outdated. */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {outdatedBadge}
          {/* One labeled Button in this header slot (next to the Score gauge):
              - brief exists → "Regenerate brief" (icon + label) in BOTH idle and
                pending; pending swaps the icon for a spinner + keeps the SAME
                label (Button's `loading` does exactly this), stays disabled and
                constant-size so the layout never jumps (R5.2, AC-11).
              - no brief → "Generate brief" CTA in the SAME slot, disabled with a
                progress affordance while pending (R5.3, AC-12).
              Progress is announced via the card's aria-live region below. */}
          {showControl ? (
            hasBrief ? (
              <Button
                icon="RefreshCw"
                kind="secondary"
                size="sm"
                loading={isRegenerating}
                aria-busy={isRegenerating}
                onClick={onRegenerate}
              >
                {t("regenerate")}
              </Button>
            ) : (
              <Button
                icon="Sparkles"
                kind="secondary"
                size="sm"
                loading={isRegenerating}
                aria-busy={isRegenerating}
                onClick={onRegenerate}
              >
                {t("empty.cta")}
              </Button>
            )
          ) : null}
        </div>

        <ScoreGauge score={score} run={run} />
      </div>
    </div>
  );
}

/* PR SCORE gauge + its cost line beneath. The gauge needs a TEXT EQUIVALENT for
   AC-18 (the numeric is visual): a visually-hidden "Score N of 100" label. No
   review → "—" plus the sr-only "Score not available". */
function ScoreGauge({ score, run }: { score: number | null; run: RunSummary | null }) {
  const t = useTranslations("brief");
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      {score != null ? (
        <div role="img" aria-label={t("scoreOf", { score })}>
          <CircularScore score={score} size={52} stroke={5} />
        </div>
      ) : (
        <div
          aria-hidden
          style={{
            width: 52,
            height: 52,
            borderRadius: 99,
            display: "grid",
            placeItems: "center",
            border: "1px solid var(--border)",
            color: "var(--text-muted)",
            fontSize: 16,
            fontWeight: 700,
          }}
        >
          {EM_DASH}
        </div>
      )}
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
        }}
      >
        {t("prScore")}
      </span>
      {score == null && <span style={srOnly}>{t("scoreUnavailable")}</span>}
      <CostLine run={run} />
    </div>
  );
}

/* Cost line under the gauge/header: cost FIRST, then input→output tokens with an
   arrow ("$0.014  8.2K→1.3K"). Reuses formatCost (— for null, never $0.00) +
   formatTokensTotal helpers; the arrow layout is header-local. */
function CostLine({ run }: { run: RunSummary | null }) {
  const cost = formatCost(run?.cost_usd);
  const hasTokens = run != null && (run.tokens_in != null || run.tokens_out != null);
  return (
    <span className="mono" style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
      {cost}
      {hasTokens && (
        <>
          {"  "}
          {formatTokensTotal(run?.tokens_in, run?.tokens_out)}
        </>
      )}
    </span>
  );
}

/* Info affordance (AC-6) — a keyboard-operable expander explaining that the header
   is COMPOSED from the latest review (zero extra LLM) and the body is the brief. */
function BriefInfo() {
  const t = useTranslations("brief");
  return (
    <CollapsibleCard
      icon="Info"
      title={t("info.title")}
      color="var(--accent-text)"
      defaultOpen={false}
      // Compact so the control reads as a badge-sized affordance next to the
      // findings/blockers badge (R5.1, AC-10); still keyboard-operable with
      // aria-expanded via the shared primitive's unchanged expander semantics.
      compact
      titleSize={12.5}
    >
      <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0, lineHeight: 1.55 }}>
        {t("info.body")}
      </p>
    </CollapsibleCard>
  );
}

// ---- Body ----

function BriefBody({
  what,
  why,
  riskLevel,
}: {
  what: string;
  why: string;
  riskLevel: RiskSeverity;
}) {
  const t = useTranslations("brief");
  const risk = RISK_META[riskLevel];
  return (
    <div>
      {/* what/why — model prose rendered as DATA via Markdown (no HTML/script). */}
      <div style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6 }}>
        <Markdown>{what}</Markdown>
        <Markdown>{why}</Markdown>
      </div>

      {/* risk_level badge — icon + textual severity label, never color alone. */}
      <div style={{ marginTop: 8 }}>
        <span title={t(`riskLevelTooltip.${riskLevel}`)}>
          <Badge color={risk.color} bg={risk.bg} icon={risk.icon}>
            <span style={srOnly}>{t("riskLevelLabel")}: </span>
            {t(`riskLevel.${riskLevel}`)}
          </Badge>
        </span>
      </div>
    </div>
  );
}

/* Empty body — no brief stored yet. Opening the page made NO LLM call (the read
   returned null). The Generate CTA now lives in the HEADER slot (next to the
   Score gauge) as the single control (R5.3, AC-12), so the body keeps ONLY its
   explanatory text — no duplicate Generate control here. */
function BriefEmptyBody() {
  const t = useTranslations("brief");
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10 }}>
      <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: 0, lineHeight: 1.55 }}>
        {t("empty.body")}
      </p>
    </div>
  );
}

function BriefBodySkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Skeleton width="90%" />
      <Skeleton width="80%" />
      <Skeleton width="40%" height={20} style={{ marginTop: 4 }} />
    </div>
  );
}
