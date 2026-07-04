import type { FolderType } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

/** Chip colour per folder type (distinct accent per type; falls back to secondary). */
const FOLDER_COLOR: Record<FolderType, string> = {
  specs: "var(--accent)",
  docs: "var(--ok)",
  insights: "var(--warn)",
};

export function folderColor(type: FolderType): string {
  return FOLDER_COLOR[type] ?? "var(--text-secondary)";
}

/** Icon per folder type (badge + list glyph). */
const FOLDER_ICON: Record<FolderType, IconName> = {
  specs: "FileText",
  docs: "Folder",
  insights: "Lightbulb",
};

export function folderIcon(type: FolderType): IconName {
  return FOLDER_ICON[type] ?? "FileText";
}

/** The directory prefix shown next to a doc name, e.g. `specs/`. Derived from
 *  the leading path segment so a nested doc still shows its containing folder. */
export function folderLabel(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : `${path.slice(0, idx)}/`;
}

/** The bare file name (last path segment). */
export function docName(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}
