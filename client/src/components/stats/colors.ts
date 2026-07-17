/* Shared color maps for the stats surfaces so severity bars and category donuts
   read consistently across the dashboard and both Stats tabs. Colors are CSS
   variables (theme-aware; meet contrast in light + dark, AC-36). */

/** Weekly stacked-severity bar colors (Critical / Warning / Suggestion). */
export const SEVERITY_COLORS: Record<"CRITICAL" | "WARNING" | "SUGGESTION", string> = {
  CRITICAL: "var(--crit)",
  WARNING: "var(--warn)",
  SUGGESTION: "var(--sugg)",
};

/** Findings-by-category donut palette (by count/share, not money). */
const CATEGORY_COLORS: Record<string, string> = {
  security: "var(--crit)",
  bug: "var(--warn)",
  perf: "var(--info)",
  style: "var(--accent)",
  test: "var(--ok)",
};

/** A rotating fallback palette for donut segments (agents / models / unknown categories). */
const PALETTE = [
  "var(--accent)",
  "var(--info)",
  "var(--ok)",
  "var(--warn)",
  "var(--crit)",
  "var(--sugg)",
];

export function categoryColor(category: string, index: number): string {
  return CATEGORY_COLORS[category] ?? PALETTE[index % PALETTE.length]!;
}

export function paletteColor(index: number): string {
  return PALETTE[index % PALETTE.length]!;
}
