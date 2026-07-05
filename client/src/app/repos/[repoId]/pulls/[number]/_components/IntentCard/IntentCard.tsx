/* IntentCard — the single "INTENT" block: derived PR intent (summary + IN/OUT
   scope lists) AND the RISK AREAS subsection, driven by ONE Recompute button.
   Rendered in the Overview tab.

   The intent summary + IN/OUT scope lists stay on the standalone Intent artifact
   (`usePrIntent` / `useRecomputeIntent`). The RISK AREAS subsection now renders the
   Why+Risk BRIEF's `risks[]` (via `useBrief`) — each risk is a keyboard-operable
   expander (severity/kind icon + title + a real file:line link) that reveals the
   risk's explanation on demand (AC-3, AC-18). The single Recompute button drives
   BOTH: it recomputes the intent AND regenerates the brief (`useRegenerateBrief`).

   SECURITY: every model-derived string (intent, scope items, risk title/explanation,
   file paths) is UNTRUSTED text rendered as plain text — React auto-escapes, no
   dangerouslySetInnerHTML (AC-21). File links resolve to a github.com blob URL
   (https only, no `javascript:`) via `githubBlobUrl`, opened in a new tab with
   `rel="noopener noreferrer"`, or degrade to plain mono text when repo/sha is
   unknown (AC-18/AC-21). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Card,
  SectionLabel,
  Button,
  Badge,
  Icon,
  CollapsibleCard,
  MonoLink,
  type IconName,
} from "@devdigest/ui";
import type { Risk, RiskSeverity } from "@devdigest/shared";
import { usePrIntent, useRecomputeIntent } from "@/lib/hooks/reviews";
import { useBrief, useRegenerateBrief } from "@/lib/hooks/brief";
import { usePullDetail } from "@/lib/hooks/core";
import { useActiveRepo } from "@/lib/repo-context";
import { githubBlobUrl } from "@/lib/github-urls";

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

/* Severity → accent color for the risk expander's round icon. Uses theme CSS vars
   (verified present in both themes in styles.css): high reads critical (red),
   medium warning (amber), low muted. WCAG: severity is never conveyed by color
   alone — see the srOnly prefix inside each row's title. */
const RISK_SEV_COLOR: Record<RiskSeverity, string> = {
  high: "var(--crit)",
  medium: "var(--warn)",
  low: "var(--text-secondary)",
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
  // RISK AREAS is now driven by the Why+Risk BRIEF, not the standalone Risks
  // artifact — the risks[] carry a real file:line ref + an explanation to reveal.
  const { data: brief } = useBrief(prId);
  const recomputeIntent = useRecomputeIntent(prId);
  const regenerateBrief = useRegenerateBrief();
  // Repo + head SHA for the risk file links — same client sources the
  // diff/findings/blast/review-focus use (repo-context + pull detail), NOT the
  // brief contract. Absent either ⇒ MonoLink degrades to plain mono text
  // (client INSIGHTS 2026-06-30).
  const { activeRepo } = useActiveRepo();
  const pull = usePullDetail(prId);

  if (isLoading) return null;

  // Derive staleness straight from the query data (derive, don't store): either
  // the stored intent OR the stored brief carries a freshness `is_stale` hint.
  // Absent / falsy ⇒ not stale (no false alarm on legacy/pre-migration records).
  const isStale = !!(intent?.is_stale || brief?.is_stale);

  // ONE button recomputes BOTH, intent FIRST: the brief reads the stored intent to
  // anchor scope, so the brief must regenerate against the FRESH intent. Sequential
  // (await) — a parallel fire would race the old intent. Errors surface via the
  // mutations' isError flags (announced below); swallow here.
  const handleRecompute = async () => {
    try {
      await recomputeIntent.mutateAsync();
      await regenerateBrief.mutateAsync(prId);
    } catch {
      /* surfaced via recomputeIntent/regenerateBrief.isError → announceText */
    }
  };

  // Derive the screen-reader announcement straight from the COMBINED mutation
  // lifecycle (derive, don't store): either pending → "Computing…", either
  // errored → "Recompute failed", both succeeded → "Intent and risks updated".
  const isRecomputing = recomputeIntent.isPending || regenerateBrief.isPending;
  const announceText = isRecomputing
    ? t("computing")
    : recomputeIntent.isError || regenerateBrief.isError
      ? t("recomputeFailed")
      : recomputeIntent.isSuccess && regenerateBrief.isSuccess
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
        <SectionLabel icon="Target" right={recomputeButton}>
          {t("block.intent")}
        </SectionLabel>
        <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: 0 }}>
          {t("unavailable")}
        </p>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6, marginBottom: 12 }}>
          {t("unavailableHint")}
        </p>
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

      <RiskAreas
        risks={brief?.risks ?? []}
        repoFullName={activeRepo?.full_name ?? null}
        headSha={pull.data?.head_sha ?? null}
      />
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

/* RISK AREAS — a vertical list of collapsed rows built from the BRIEF's risks[].
   Each row is a keyboard-operable expander (CollapsibleCard: whole header toggles
   on click / Enter / Space, exposes aria-expanded, chevron rotates): a severity-
   toned kind icon + the risk title (prefixed with a textual severity label — WCAG,
   severity is never conveyed by color alone) + the real file:line link(s) in the
   header's right slot; expanding reveals the risk's explanation. */
function RiskAreas({
  risks,
  repoFullName,
  headSha,
}: {
  risks: Risk[];
  repoFullName: string | null;
  headSha: string | null;
}) {
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
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {risks.map((risk, i) => (
            <RiskRow
              key={`${risk.kind}-${risk.title}-${i}`}
              risk={risk}
              repoFullName={repoFullName}
              headSha={headSha}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* One collapsed risk row (R4). CollapsibleCard's title is a plain string, so the
   severity is a VISIBLE textual prefix on the title ("High severity: …") — that
   keeps the severity readable without relying on color (WCAG). The title renders
   at 13px, still bold, via the additive `titleSize` prop — same size as the
   surrounding INTENT text (AC-9). The file:line ref(s) move OUT of the header
   `right` slot onto their OWN row(s) in the card BODY, above the explanation, so
   long refs no longer crowd the title. A risk with no refs shows the title row
   only and still expands to its explanation. Refs/title/explanation are untrusted
   model text; MonoLink → github blob at the head SHA (https), degrading to plain
   mono text when repo/sha is unknown (AC-16). */
function RiskRow({
  risk,
  repoFullName,
  headSha,
}: {
  risk: Risk;
  repoFullName: string | null;
  headSha: string | null;
}) {
  const t = useTranslations("brief");
  const icon = RISK_ICON[risk.kind] ?? "AlertTriangle";
  const color = RISK_SEV_COLOR[risk.severity];
  const refs = risk.file_refs.map(parseFileRef);

  return (
    <CollapsibleCard
      icon={icon}
      color={color}
      defaultOpen={false}
      titleSize={13}
      title={`${t(`severity.${risk.severity}`)}: ${risk.title}`}
    >
      {/* File refs — each on its OWN row below the title (AC-9), inside the body,
          above the explanation. */}
      {refs.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
          {refs.map((ref, i) => (
            <span key={`${ref.label}-${i}`} title={ref.label} style={{ minWidth: 0 }}>
              <MonoLink href={blobHref(repoFullName, headSha, ref.path, ref.startLine, ref.endLine)}>
                {ref.label}
              </MonoLink>
            </span>
          ))}
        </div>
      ) : null}

      {/* explanation is LLM-derived untrusted text — plain text, React auto-escapes. */}
      <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0, lineHeight: 1.55 }}>
        {risk.explanation}
      </p>
    </CollapsibleCard>
  );
}

// ---- Helpers ----

/** A parsed `file_refs` entry. The line-range travels INSIDE the string, e.g.
    `src/mw/ratelimit.ts:12-18` or `package.json:34`; a bare `path` (no range)
    yields no line numbers. `label` is the original ref re-rendered for display. */
interface ParsedFileRef {
  path: string;
  startLine?: number;
  endLine?: number;
  label: string;
}

/** Parse a `path:range` file ref. Splits on the LAST colon so Windows-style or
    already-decorated paths keep their path portion; the range is `start` or
    `start-end`. Non-numeric / malformed ranges degrade to a bare path (label keeps
    the original string). Path/label are rendered as plain text (untrusted). */
function parseFileRef(ref: string): ParsedFileRef {
  const lastColon = ref.lastIndexOf(":");
  if (lastColon <= 0) return { path: ref, label: ref };

  const path = ref.slice(0, lastColon);
  const range = ref.slice(lastColon + 1);
  const [startRaw, endRaw] = range.split("-");
  const startLine = Number(startRaw);
  if (!Number.isInteger(startLine) || startLine <= 0) {
    // Not a real line range (e.g. a bare path that happens to contain a colon) —
    // keep the whole ref as the path.
    return { path: ref, label: ref };
  }
  const endParsed = Number(endRaw);
  const endLine = Number.isInteger(endParsed) && endParsed > 0 ? endParsed : undefined;
  return { path, startLine, endLine, label: ref };
}

/** github.com blob deep-link for a risk file at the PR head, or undefined when the
    repo/sha isn't known yet (→ MonoLink falls back to plain text). The head SHA
    pins line numbers (github-urls convention). Always https (safe protocol,
    AC-18/AC-21). */
function blobHref(
  repoFullName: string | null,
  headSha: string | null,
  file: string,
  startLine?: number,
  endLine?: number,
): string | undefined {
  return repoFullName && headSha
    ? githubBlobUrl(repoFullName, headSha, file, startLine, endLine)
    : undefined;
}
