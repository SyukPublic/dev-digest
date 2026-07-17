/** Display formatters shared across run-cost surfaces (PR list, run timeline,
 *  run trace sidebar). Keeping them here means the "—, never $0.00" rule and
 *  the precision live in ONE place. */

/**
 * USD cost for a run/batch. Unknown cost (null/undefined) → "—" — NEVER "$0.00",
 * which would read as "this run was free". Sub-cent runs need extra precision;
 * ≥ $0.10 reads fine at 3 decimals.
 */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null) return "—";
  return `$${usd.toFixed(usd < 0.1 ? 4 : 3)}`;
}

/**
 * Accept-rate (0..1) as a whole-percent string. Unknown rate (null/undefined —
 * no findings were acted on) → "—", NEVER "0%", which would read as "everything
 * was rejected" (AC-8). Used across all three stats surfaces.
 */
export function formatAcceptRate(rate: number | null | undefined): string {
  if (rate == null) return "—";
  return `${Math.round(rate * 100)}%`;
}

/**
 * A 0..1 share as a whole-percent string (pull frequency, trace shares). Unknown
 * (null/undefined) → "—". A genuine 0 renders "0%" (distinct from unknown).
 */
export function formatPct(share: number | null | undefined): string {
  if (share == null) return "—";
  return `${Math.round(share * 100)}%`;
}

/** Total tokens (in + out) for the timeline badge, e.g. "9 119 tok". */
export function formatTokensTotal(
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
): string {
  const total = (tokensIn ?? 0) + (tokensOut ?? 0);
  return `${total.toLocaleString("en-US").replace(/,/g, " ")} tok`;
}
