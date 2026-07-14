"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Textarea, Badge, Icon } from "@devdigest/ui";
import type { CiFile } from "@devdigest/shared";
import { s } from "../../../styles";

/**
 * Step 2 — preview the generated bundle. The file list is selectable; the
 * selected file's contents render in an editor. Edits to `editable` files are
 * held by the parent and carried into the Install request (AC-6).
 */
export function PreviewStep({
  files,
  generating,
  selectedPath,
  onSelect,
  edits,
  onEdit,
}: {
  files: CiFile[];
  generating: boolean;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  edits: Record<string, string>;
  onEdit: (path: string, contents: string) => void;
}) {
  const t = useTranslations("ci");
  const selected = files.find((f) => f.path === selectedPath) ?? null;
  const contents = selected ? (edits[selected.path] ?? selected.contents) : "";

  if (generating) {
    return (
      <div role="status" aria-live="polite" style={{ display: "flex", alignItems: "center", gap: 8, padding: 24, color: "var(--text-secondary)" }}>
        <Icon.RefreshCw size={14} className="dd-spin" />
        {t("exportWizard.generating")}
      </div>
    );
  }

  return (
    <div style={s.previewGrid}>
      <div>
        <div style={{ ...s.sectionLabel, marginBottom: 8 }}>{t("exportWizard.filesToCreate")}</div>
        <div style={s.fileList}>
          {files.map((f) => (
            <button
              key={f.path}
              type="button"
              aria-pressed={f.path === selectedPath}
              onClick={() => onSelect(f.path)}
              style={s.fileRow(f.path === selectedPath)}
            >
              {f.path}
            </button>
          ))}
        </div>
      </div>

      <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
        {selected && (
          <>
            <div style={s.editorHeader}>
              <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, flex: 1, wordBreak: "break-all" }}>
                {selected.path}
              </span>
              {selected.editable && (
                <Badge color="var(--ok)" bg="var(--ok-bg)" icon="Edit">
                  {t("exportWizard.editable")}
                </Badge>
              )}
            </div>
            <Textarea
              value={contents}
              // Non-editable files render read-only (no-op onChange → value can't change).
              onChange={selected.editable ? (v: string) => onEdit(selected.path, v) : () => {}}
              rows={14}
              mono
            />
          </>
        )}
      </div>
    </div>
  );
}
