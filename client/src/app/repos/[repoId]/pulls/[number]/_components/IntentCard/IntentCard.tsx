/* IntentCard — the single "INTENT" block: derived PR intent (summary + IN/OUT
   scope lists) AND the RISK AREAS subsection, driven by ONE Recompute button.
   Rendered in the Overview tab. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, SectionLabel, Button, Badge, Icon, type IconName } from "@devdigest/ui";
import type { Risk, RiskSeverity } from "@devdigest/shared";
import {
  usePrIntent,
  useRecomputeIntent,
  usePrRisks,
  useRecomputeRisks,
} from "@/lib/hooks/reviews";

interface IntentCardProps {
  prId: string;
}

/* Visually hidden, but read by assistive tech (copied verbatim from
   AppShell.tsx's srOnly so the aria-live status region is in the DOM but
   invisible to sighted users). */
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

/* Scope tones — color-coded per the design: in-scope reads positive (green),
   out-of-scope reads muted. The circle icon (check/cross) marks the HEADER; list
   items use a plain colored dot. */
const SCOPE_TONE: Record<
  "in" | "out",
  { color: string; text: string; icon: IconName }
> = {
  in: { color: "var(--ok)", text: "var(--text-secondary)", icon: "CheckCircle" },
  out: { color: "var(--text-muted)", text: "var(--text-muted)", icon: "XCircle" },
};

/* Severity → color/background. Uses theme CSS vars (verified present in both
   themes in styles.css): high reads critical (red), medium warning (amber), low
   muted. WCAG: severity is never conveyed by color alone — see the srOnly prefix
   inside each pill. */
const RISK_SEV: Record<RiskSeverity, { color: string; bg: string }> = {
  high: { color: "var(--crit)", bg: "var(--crit-bg)" },
  medium: { color: "var(--warn)", bg: "var(--warn-bg)" },
  low: { color: "var(--text-secondary)", bg: "var(--bg-hover)" },
};

/* Risk kind → icon. Only icons verified present in the registry are used; the
   fallback is AlertTriangle. */
const RISK_ICON: Record<string, IconName> = {
  auth: "Shield",
  security: "Shield",
  dependency: "Boxes",
  performance: "Zap",
  network: "Globe",
  database: "Database",
};

export function IntentCard({ prId }: IntentCardProps) {
  const t = useTranslations("brief");
  const { data: intent, isLoading } = usePrIntent(prId);
  const { data: risksRecord } = usePrRisks(prId);
  const recomputeIntent = useRecomputeIntent(prId);
  const recomputeRisks = useRecomputeRisks(prId);

  if (isLoading) return null;

  // Derive staleness straight from the query data (derive, don't store): either
  // the stored intent OR risks record carries a freshness `is_stale` hint. Absent
  // / falsy ⇒ not stale (no false alarm on legacy/pre-migration records).
  const isStale = !!(intent?.is_stale || risksRecord?.is_stale);

  // ONE button recomputes BOTH, intent FIRST: the server risks-service reads the
  // stored intent to anchor scope, so risks must run against the FRESH intent.
  // Sequential (await) — a parallel fire would race the old intent. Errors surface
  // via the mutations' isError flags (announced below); swallow here.
  const handleRecompute = async () => {
    try {
      await recomputeIntent.mutateAsync();
      await recomputeRisks.mutateAsync();
    } catch {
      /* surfaced via recompute*.isError → announceText */
    }
  };

  // Derive the screen-reader announcement straight from the COMBINED mutation
  // lifecycle (derive, don't store): either pending → "Computing…", either
  // errored → "Recompute failed", both succeeded → "Intent and risks updated".
  const isRecomputing = recomputeIntent.isPending || recomputeRisks.isPending;
  const announceText = isRecomputing
    ? t("computing")
    : recomputeIntent.isError || recomputeRisks.isError
      ? t("recomputeFailed")
      : recomputeIntent.isSuccess && recomputeRisks.isSuccess
        ? t("briefUpdated")
        : "";

  /* Stale hint — rendered only when `isStale`. Badge has no `title` prop, so wrap
     it in a span carrying the native hover tooltip (same pattern as RiskAreas).
     State is conveyed by icon + the textual label, never color alone (WCAG). */
  const staleBadge = isStale ? (
    <span title={t("staleTooltip")}>
      <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
        {t("staleBadge")}
      </Badge>
    </span>
  ) : null;

  /* The single Recompute button bundled with its visually-hidden aria-live status
     region (plus the optional stale badge beside it), so both the normal and the
     "unavailable" render branches announce the full combined Recompute state
     transition without duplicating the region. */
  const recomputeButton = (
    <>
      {staleBadge}
      <Button
        icon="Sparkles"
        kind="secondary"
        size="sm"
        loading={isRecomputing}
        aria-busy={isRecomputing}
        onClick={handleRecompute}
      >
        {isRecomputing ? t("computing") : t("recompute")}
      </Button>
      <div role="status" aria-live="polite" aria-atomic="true" style={srOnly}>
        {announceText}
      </div>
    </>
  );

  // Unavailable state: no intent computed yet (null or undefined)
  if (intent == null) {
    return (
      <Card>
        <SectionLabel icon="Target">{t("block.intent")}</SectionLabel>
        <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: 0 }}>
          {t("unavailable")}
        </p>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6, marginBottom: 12 }}>
          {t("unavailableHint")}
        </p>
        {recomputeButton}
      </Card>
    );
  }

  return (
    <Card>
      <SectionLabel icon="Target" right={recomputeButton}>
        {t("block.intent")}
      </SectionLabel>

      {/* Intent summary — plain text; React auto-escapes; no dangerouslySetInnerHTML */}
      <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 0, marginBottom: 16, lineHeight: 1.55 }}>
        {intent.intent}
      </p>

      <ScopeList
        tone="in"
        label={t("inScope")}
        items={intent.in_scope}
        emptyLabel={t("emptyScope")}
      />

      <ScopeList
        tone="out"
        label={t("outOfScope")}
        items={intent.out_of_scope}
        emptyLabel={t("emptyScope")}
      />

      <RiskAreas risks={risksRecord?.risks ?? []} />
    </Card>
  );
}

// ---- Private sub-components ----

function ScopeList({
  tone,
  label,
  items,
  emptyLabel,
}: {
  tone: "in" | "out";
  label: string;
  items: string[];
  emptyLabel: string;
}) {
  const { color, text, icon } = SCOPE_TONE[tone];
  const ToneIcon = Icon[icon];
  return (
    <div style={{ marginBottom: 14 }}>
      {/* Header keeps the circle icon (check / cross) */}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color,
          marginBottom: 8,
        }}
      >
        <ToneIcon size={13} />
        {label}
      </span>
      {items.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{emptyLabel}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map((item) => (
            <span
              key={item}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                color: text,
              }}
            >
              {/* List items use a plain colored dot, not a circle icon */}
              <span
                aria-hidden
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: 99,
                  background: color,
                  flexShrink: 0,
                }}
              />
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* RISK AREAS — compact pills inside the same INTENT card. Each risk is one pill
   per line (vertical stack — one finding per row), severity color + kind icon +
   title; the full explanation lives in the native `title` tooltip (the compact
   design drops the verbose paragraphs and file_refs rows). */
function RiskAreas({ risks }: { risks: Risk[] }) {
  const t = useTranslations("brief");
  return (
    <div style={{ marginBottom: 0 }}>
      {/* Header styled like the scope-list headers; warning-toned. */}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--warn)",
          marginBottom: 8,
        }}
      >
        <Icon.AlertTriangle size={13} />
        {t("block.risks")}
      </span>
      {risks.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("noRisks")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
          {risks.map((risk, i) => {
            const sev = RISK_SEV[risk.severity];
            const icon = RISK_ICON[risk.kind] ?? "AlertTriangle";
            return (
              /* Badge has no `title` prop, so wrap it in a span that carries the
                 native hover tooltip (plain text; no info lost from the compact
                 layout). */
              <span key={`${risk.kind}-${risk.title}-${i}`} title={risk.explanation}>
                <Badge color={sev.color} bg={sev.bg} icon={icon}>
                  {/* Severity by color + a textual prefix (WCAG: never color
                      alone). risk.title is server-derived untrusted text —
                      rendered as plain text; React auto-escapes. */}
                  <span style={srOnly}>{t(`severity.${risk.severity}`)}: </span>
                  {risk.title}
                </Badge>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
