import type { ConventionCandidate } from "@devdigest/shared";

/** Pure helpers for the Conventions list view — grouping, color, scan-detection. */

export interface CategoryGroup {
  category: string;
  items: ConventionCandidate[];
}

/** Group candidates by category (server already sorts items by confidence desc). */
export function groupByCategory(list: ConventionCandidate[]): CategoryGroup[] {
  const map = new Map<string, ConventionCandidate[]>();
  for (const c of list) {
    const key = c.category?.trim() || "general";
    const arr = map.get(key);
    if (arr) arr.push(c);
    else map.set(key, [c]);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, items]) => ({ category, items }));
}

/** Confidence → semantic color (matches the review severity palette). */
export function confidenceColor(confidence: number): string {
  if (confidence >= 0.85) return "var(--ok)";
  if (confidence >= 0.7) return "var(--warn)";
  return "var(--crit)";
}

/** Newest `extracted_at` in the list — the signal a re-scan has landed. */
export function newestStamp(list: ConventionCandidate[]): string | null {
  let newest: string | null = null;
  for (const c of list) {
    if (c.extracted_at && (!newest || c.extracted_at > newest)) newest = c.extracted_at;
  }
  return newest;
}
