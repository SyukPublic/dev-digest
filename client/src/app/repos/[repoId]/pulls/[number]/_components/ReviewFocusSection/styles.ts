import type { CSSProperties } from "react";

/** Co-located styles for the Review focus section (R3). The list is framed like
 *  the Overview Description box (border/radius/bg-elevated) so the section reads
 *  as a sibling of the other framed sections; the SectionLabel header sits above
 *  the frame, mirroring the Description block's label-above-box layout. */
export const s = {
  frame: {
    listStyle: "none",
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
  } satisfies CSSProperties,
} as const;
