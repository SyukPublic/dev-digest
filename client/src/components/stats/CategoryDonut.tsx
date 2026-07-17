/* CategoryDonut — findings-by-category donut segmented by COUNT/SHARE (not money;
   the "$" in the mockups is a placeholder). Shared by the Agent + Skill Stats
   tabs. Carries an accessible label (AC-26/33/36); category names render as
   escaped text via the Donut legend (default JSX escaping). */
import React from "react";
import { Donut } from "@devdigest/ui";
import type { CategoryCount } from "@devdigest/shared";
import { categoryColor } from "./colors";

export function CategoryDonut({
  data,
  emptyLabel,
  ariaLabel,
}: {
  data: CategoryCount[];
  emptyLabel: string;
  ariaLabel: string;
}) {
  if (data.length === 0) {
    return <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{emptyLabel}</span>;
  }
  const segments = data.map((d, i) => ({
    label: d.category,
    value: d.count,
    color: categoryColor(d.category, i),
  }));
  const summary = data.map((d) => `${d.category} ${d.count}`).join(", ");
  return (
    <div role="img" aria-label={`${ariaLabel}: ${summary}`}>
      {/* count/share donut — no monetary prefix */}
      <Donut segments={segments} valuePrefix="" />
    </div>
  );
}
