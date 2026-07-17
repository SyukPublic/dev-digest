/* period.ts — the shared stats period model used by the period control and the
   three stats hooks. Mirrors the server's `PeriodQuery` (?days=1|30 | ?from&to),
   defaulting to the last 30 days. Kept in `lib/` so the control (a shared
   component) and the hooks both depend on it without a cross-feature import. */

export type StatsPeriod =
  | { kind: "days"; days: 1 | 30 }
  | { kind: "range"; from: string; to: string };

/** Default period when a surface first mounts (AC-3): last 30 days. */
export const DEFAULT_PERIOD: StatsPeriod = { kind: "days", days: 30 };

/** The querystring for the stats endpoints (`?days=…` or `?from=…&to=…`). */
export function periodToQuery(p: StatsPeriod): string {
  if (p.kind === "days") return `?days=${p.days}`;
  return `?from=${encodeURIComponent(p.from)}&to=${encodeURIComponent(p.to)}`;
}

/** A stable fragment for a React Query key so a period change refetches. */
export function periodKey(p: StatsPeriod): string {
  return p.kind === "days" ? `d${p.days}` : `r:${p.from}:${p.to}`;
}

/**
 * The active-period label for period-scoped card sublabels (AC-10) — cards must
 * reflect the selected period, never a hardcoded "30D".
 */
export function periodLabel(p: StatsPeriod): string {
  if (p.kind === "days") return p.days === 1 ? "1D" : "30D";
  return "range";
}
