/* ContextRow — one attachable document row (CP-8 style): keyboard-and-drag
   reorder handle, attach checkbox, folder-type icon + mono name + folder path,
   type badge, token count, a "missing" badge for unresolved paths (AC-15), and
   a Preview button. Net-new vs SkillsTab: up/down keyboard reorder buttons so
   reorder is operable without a pointer (AC-19). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import type { DiscoveredDocument } from "@devdigest/shared";
import { docName, folderColor, folderIcon, folderLabel } from "@/lib/project-context";
import { s } from "./styles";

export function ContextRow({
  doc,
  attached,
  dragging,
  canMoveUp,
  canMoveDown,
  onToggle,
  onPreview,
  onMove,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  doc: DiscoveredDocument;
  attached: boolean;
  dragging: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggle: () => void;
  onPreview: () => void;
  onMove: (dir: "up" | "down") => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
}) {
  const t = useTranslations("context");
  const FolderGlyph = Icon[folderIcon(doc.folder_type)];
  const missing = !!doc.missing;
  const name = docName(doc.path);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={s.row(attached, dragging, missing)}
      data-testid="context-row"
    >
      {/* Keyboard-operable reorder (net-new for a11y) — the drag handle icon sits
          between the up/down buttons so both pointer and keyboard reorder work. */}
      <div style={s.reorder}>
        <button
          type="button"
          onClick={() => onMove("up")}
          disabled={!canMoveUp}
          aria-label={t("row.moveUp", { name })}
          style={s.reorderBtn(!canMoveUp)}
        >
          <Icon.ArrowUp size={12} />
        </button>
        <button
          type="button"
          onClick={() => onMove("down")}
          disabled={!canMoveDown}
          aria-label={t("row.moveDown", { name })}
          style={s.reorderBtn(!canMoveDown)}
        >
          <Icon.ArrowDown size={12} />
        </button>
      </div>
      <Icon.Menu size={15} style={{ color: "var(--text-muted)", cursor: "grab" }} aria-hidden />

      <input
        type="checkbox"
        checked={attached}
        onChange={onToggle}
        aria-label={t("row.attach", { name })}
        style={{ cursor: "pointer" }}
      />

      <FolderGlyph size={14} style={{ color: folderColor(doc.folder_type) }} aria-hidden />
      <span className="mono" style={s.name}>
        {name}
      </span>
      <span className="mono" style={s.folder}>
        {folderLabel(doc.path)}
      </span>

      <div style={s.spacer} />

      {missing && (
        <Badge color="var(--warn)" icon="AlertTriangle">
          {t("row.missing")}
        </Badge>
      )}
      {!missing && <span style={s.folder}>{t("tokens", { count: doc.tokens })}</span>}
      <Badge color={folderColor(doc.folder_type)} mono>
        {doc.folder_type}
      </Badge>
      <button type="button" onClick={onPreview} style={s.previewBtn}>
        <Icon.Eye size={12} />
        {t("row.preview")}
      </button>
    </div>
  );
}
