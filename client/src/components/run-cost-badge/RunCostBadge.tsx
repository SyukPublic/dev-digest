"use client";

import React from "react";
import { formatCost, formatTokensTotal } from "@/lib/format";

/**
 * The cost (USD) of one run / review batch, in two flavours:
 *   - "compact"    → "$0.012"                 (PR list COST column)
 *   - "withTokens" → "9 119 tok · $0.0013"    (agent-runs timeline meta line)
 *
 * Unknown cost renders a muted "—" (never "$0.00") — see `formatCost`.
 */
export function RunCostBadge({
  costUsd,
  tokensIn,
  tokensOut,
  variant = "compact",
}: {
  costUsd: number | null | undefined;
  tokensIn?: number | null;
  tokensOut?: number | null;
  variant?: "compact" | "withTokens";
}) {
  const known = costUsd != null;
  const color = known ? "var(--text-secondary)" : "var(--text-muted)";
  if (variant === "withTokens") {
    return (
      <span className="mono" style={{ fontSize: 11.5, color }}>
        {formatTokensTotal(tokensIn, tokensOut)} · {formatCost(costUsd)}
      </span>
    );
  }
  return (
    <span className="mono" style={{ fontSize: 12, color }}>
      {formatCost(costUsd)}
    </span>
  );
}
