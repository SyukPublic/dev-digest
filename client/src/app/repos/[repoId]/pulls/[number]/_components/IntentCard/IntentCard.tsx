/* IntentCard — displays the derived PR intent (summary + scope lists) and
   provides a Recompute button. Rendered in the Overview tab. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, SectionLabel, Button, Icon, type IconName } from "@devdigest/ui";
import { usePrIntent, useRecomputeIntent } from "@/lib/hooks/reviews";

interface IntentCardProps {
  prId: string;
}

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

export function IntentCard({ prId }: IntentCardProps) {
  const t = useTranslations("brief");
  const { data: intent, isLoading } = usePrIntent(prId);
  const recompute = useRecomputeIntent(prId);

  if (isLoading) return null;

  const recomputeButton = (
    <Button
      icon="Sparkles"
      kind="secondary"
      size="sm"
      loading={recompute.isPending}
      aria-busy={recompute.isPending}
      onClick={() => recompute.mutate()}
    >
      {recompute.isPending ? t("computing") : t("recompute")}
    </Button>
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
    </Card>
  );
}

// ---- Private sub-component ----

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
