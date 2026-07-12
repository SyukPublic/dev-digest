/* MetricCell — a table-cell metric readout (Mockups 1/3): a small colored meter
   bar carrying the metric's identity + the percent value as plain text (values
   wear text tokens, never the series color). Null → "—" with no bar (AC-18).
   The bar is decorative — identity is also carried by the column header — so it
   is aria-hidden. Shared by the all-agents and per-agent recent-runs tables. */
import React from "react";
import { ProgressBar } from "@devdigest/ui";
import { fmtPct } from "./helpers";

/** Canonical metric → color mapping (matches the metric cards + trend chart). */
export const METRIC_COLORS = {
  recall: "var(--accent)",
  precision: "var(--ok)",
  citation: "var(--warn)",
} as const;

export function MetricCell({ value, color }: { value: number | null | undefined; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {value != null && (
        <span style={{ width: 72, flexShrink: 0 }} aria-hidden>
          <ProgressBar value={value * 100} color={color} height={4} />
        </span>
      )}
      <span className="tnum" style={{ minWidth: 34 }}>{fmtPct(value)}</span>
    </span>
  );
}
