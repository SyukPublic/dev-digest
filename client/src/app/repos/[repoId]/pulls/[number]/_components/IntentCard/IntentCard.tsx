/* IntentCard — displays the derived PR intent (summary + scope lists) and
   provides a Recompute button. Rendered in the Overview tab. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, SectionLabel, Chip, Button } from "@devdigest/ui";
import { usePrIntent, useRecomputeIntent } from "@/lib/hooks/reviews";

interface IntentCardProps {
  prId: string;
}

export function IntentCard({ prId }: IntentCardProps) {
  const t = useTranslations("brief");
  const { data: intent, isLoading } = usePrIntent(prId);
  const recompute = useRecomputeIntent(prId);

  if (isLoading) return null;

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
        <Button
          icon="Sparkles"
          kind="secondary"
          size="sm"
          loading={recompute.isPending}
          onClick={() => recompute.mutate()}
        >
          {recompute.isPending ? t("computing") : t("recompute")}
        </Button>
      </Card>
    );
  }

  return (
    <Card>
      <SectionLabel
        icon="Target"
        right={
          <Button
            icon="Sparkles"
            kind="secondary"
            size="sm"
            loading={recompute.isPending}
            onClick={() => recompute.mutate()}
          >
            {recompute.isPending ? t("computing") : t("recompute")}
          </Button>
        }
      >
        {t("block.intent")}
      </SectionLabel>

      {/* Intent summary — plain text; React auto-escapes; no dangerouslySetInnerHTML */}
      <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 0, marginBottom: 16, lineHeight: 1.55 }}>
        {intent.intent}
      </p>

      <ScopeList
        label={t("inScope")}
        items={intent.in_scope}
        emptyLabel={t("emptyScope")}
      />

      <ScopeList
        label={t("outOfScope")}
        items={intent.out_of_scope}
        emptyLabel={t("emptyScope")}
      />
    </Card>
  );
}

// ---- Private sub-component ----

function ScopeList({
  label,
  items,
  emptyLabel,
}: {
  label: string;
  items: string[];
  emptyLabel: string;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <span
        style={{
          display: "block",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          marginBottom: 8,
        }}
      >
        {label}
      </span>
      {items.length === 0 ? (
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{emptyLabel}</span>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {items.map((item) => (
            <Chip key={item} icon="ListChecks">
              {item}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
