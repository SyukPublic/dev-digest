/* MemoryCard — one memory entry in the center list: kind badge + scope pill,
   confidence, content (inline code rendered safely), source PR chips, and the
   last-used date. The whole card is a button so selection is keyboard-operable. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, ConfidenceNum } from "@devdigest/ui";
import type { Memory } from "@devdigest/shared";
import { MemoryContent } from "./MemoryContent";
import { KIND_ICON, daysSince } from "./helpers";
import { s } from "./styles";

function usedLabel(t: ReturnType<typeof useTranslations>, lastUsedAt: string | null): string {
  const d = daysSince(lastUsedAt);
  if (d === null) return t("card.neverUsed");
  if (d <= 0) return t("card.usedToday");
  if (d === 1) return t("card.usedDayAgo");
  return t("card.usedDaysAgo", { days: d });
}

export function MemoryCard({
  entry,
  selected,
  onSelect,
}: {
  entry: Memory;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations("memory");
  const prChips = entry.sources.filter((src) => src.pr != null);

  return (
    <button
      type="button"
      style={s.card(selected)}
      aria-pressed={selected}
      aria-label={t("card.select")}
      onClick={onSelect}
    >
      <div style={s.cardTop}>
        <Badge icon={KIND_ICON[entry.kind]} color="var(--text-secondary)">
          {t(`kind.${entry.kind}`)}
        </Badge>
        <Badge color="var(--accent)">{t(`scope.${entry.scope}`)}</Badge>
        <div style={s.cardGrow} />
        <ConfidenceNum value={entry.confidence} />
      </div>

      <MemoryContent content={entry.content} style={s.cardContent} />

      <div style={s.cardBottom}>
        <div style={s.chips}>
          {prChips.map((src, i) => (
            <Badge key={i} mono color="var(--text-muted)">
              {t("detail.prLabel", { pr: src.pr! })}
            </Badge>
          ))}
        </div>
        <span style={s.usedDate}>{usedLabel(t, entry.last_used_at)}</span>
      </div>
    </button>
  );
}
