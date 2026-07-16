import type { IconName } from "@devdigest/ui";
import type { MemoryKind } from "@devdigest/shared";

/** The stale threshold (days) — mirrors the server STALE_DAYS (AC-16). */
export const STALE_DAYS = 60;

/** Icon per memory kind (icon + label badge — never color alone). */
export const KIND_ICON: Record<MemoryKind, IconName> = {
  decision: "Zap",
  convention: "ListChecks",
  preference: "Star",
  fact: "Database",
  learning: "Lightbulb",
};

/** Whole days since an ISO timestamp; null when never used. */
export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
}

/** An entry is stale when never used or last used more than STALE_DAYS ago. */
export function isStale(lastUsedAt: string | null): boolean {
  const d = daysSince(lastUsedAt);
  return d === null || d > STALE_DAYS;
}

/** Short YYYY-MM-DD for the metadata rows. */
export function isoDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

/**
 * Split content into plain-text and inline-code segments on backtick pairs, so
 * the UI can render `code` spans as <code> while everything (incl. the code) is
 * escaped by React — content is NEVER injected as HTML (AC-24, A05).
 */
export interface Segment {
  code: boolean;
  text: string;
}

export function splitInlineCode(content: string): Segment[] {
  const out: Segment[] = [];
  const re = /`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) out.push({ code: false, text: content.slice(last, m.index) });
    out.push({ code: true, text: m[1]! });
    last = m.index + m[0].length;
  }
  if (last < content.length) out.push({ code: false, text: content.slice(last) });
  return out;
}
