import React from "react";
import type { PrFindingCounts, Severity } from "@devdigest/shared";
import { Chip } from "./Chip";
import { SEV } from "./tokens";

/** The three canonical severity levels, in display order (worst first). */
export const SEVERITY_LEVELS: readonly Severity[] = ["CRITICAL", "WARNING", "SUGGESTION"];

/**
 * Severity tally as a row of toggle chips (one per level present in `counts`).
 * Purely presentational — the parent owns the `active` set, so a popover can
 * reset it on open while an inline panel keeps it. A level with a zero count is
 * omitted (nothing to filter). Clicking a chip toggles that level via `onToggle`.
 */
export function SeverityFilter({
  counts,
  active,
  onToggle,
}: {
  counts: PrFindingCounts;
  active: Set<Severity>;
  onToggle: (severity: Severity) => void;
}) {
  const present = SEVERITY_LEVELS.filter((sev) => counts[sev] > 0);
  if (present.length === 0) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {present.map((sev) => {
        const meta = SEV[sev];
        const on = active.has(sev);
        return (
          <Chip
            key={sev}
            icon={meta.icon}
            color={meta.c}
            count={counts[sev]}
            active={on}
            onClick={() => onToggle(sev)}
            ariaLabel={`${on ? "Hide" : "Show"} ${meta.label.toLowerCase()} findings (${counts[sev]})`}
          >
            {meta.label.toUpperCase()}
          </Chip>
        );
      })}
    </div>
  );
}
