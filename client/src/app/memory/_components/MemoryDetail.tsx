/* MemoryDetail — right pane. Shows the selected entry's kind badge, edit/delete
   actions, content, a CONFIDENCE · SCOPE · UPDATED meta row, and the source
   contexts (PR # + context text). With no selection it shows a placeholder
   (AC-17). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, EmptyState, IconBtn } from "@devdigest/ui";
import type { Memory } from "@devdigest/shared";
import { MemoryContent } from "./MemoryContent";
import { KIND_ICON, isoDate } from "./helpers";
import { s } from "./styles";

export function MemoryDetail({
  entry,
  onEdit,
  onDelete,
}: {
  entry: Memory | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("memory");

  if (!entry) {
    return (
      <aside style={s.detail} aria-label={t("detail.empty.title")}>
        <EmptyState icon="Brain" title={t("detail.empty.title")} body={t("detail.empty.body")} />
      </aside>
    );
  }

  const pct = Math.round(entry.confidence * 100);

  return (
    <aside style={s.detail} aria-label={t("detail.stat.confidence")}>
      <div style={s.detailTop}>
        <Badge icon={KIND_ICON[entry.kind]} color="var(--text-secondary)">
          {t(`kind.${entry.kind}`)}
        </Badge>
        <div style={s.detailActions}>
          <IconBtn icon="Edit" label={t("detail.edit")} onClick={onEdit} />
          <IconBtn icon="Trash" label={t("detail.delete")} danger onClick={onDelete} />
        </div>
      </div>

      <MemoryContent content={entry.content} style={s.detailContent} />

      <div style={s.metaRow}>
        <span>
          {t("detail.stat.confidence")} {pct}%
        </span>
        <span aria-hidden>·</span>
        <span>
          {t("detail.stat.scope")} {t(`scope.${entry.scope}`)}
        </span>
        <span aria-hidden>·</span>
        <span>
          {t("detail.stat.updated")} {isoDate(entry.updated_at)}
        </span>
      </div>

      <div style={s.railSection}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          {t("detail.sourceContexts")}
        </div>
        {entry.sources.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("detail.noSources")}</div>
        ) : (
          entry.sources.map((src, i) => (
            <div key={i} style={s.sourceCard}>
              {src.pr != null && (
                <Badge mono color="var(--accent)">
                  {t("detail.prLabel", { pr: src.pr })}
                </Badge>
              )}
              <span style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                {src.context}
              </span>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
