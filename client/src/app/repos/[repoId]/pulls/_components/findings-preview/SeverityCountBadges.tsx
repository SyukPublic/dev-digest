/* SeverityCountBadges — compact per-severity count badges (e.g. 🔴4 ⚠6 💡2),
   shared by the PR-list FINDINGS cell and the PR-detail timeline run rows.
   Levels with a zero count are omitted. */
"use client";

import React from "react";
import { SeverityBadge, SEVERITY_LEVELS } from "@devdigest/ui";
import type { PrFindingCounts } from "@devdigest/shared";

export function SeverityCountBadges({ counts }: { counts: PrFindingCounts }) {
  return (
    <>
      {SEVERITY_LEVELS.filter((sev) => counts[sev] > 0).map((sev) => (
        <SeverityBadge key={sev} severity={sev} count={counts[sev]} compact />
      ))}
    </>
  );
}
