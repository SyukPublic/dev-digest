/* Sparkline — lightweight inline-SVG trend line (no Recharts; trivial + perf). */
import React from "react";

export function Sparkline({
  data,
  color = "var(--accent)",
  w = 80,
  h = 24,
}: {
  data: number[];
  color?: string;
  w?: number;
  h?: number;
}) {
  if (!data.length) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  // A single point would make `i/(length-1)` = 0/0 = NaN (→ NaN in `d`/`cx`);
  // fall back to a divisor of 1 so a one-element series renders at x=0.
  const denom = data.length - 1 || 1;
  const pts = data.map((v, i) => [(i / denom) * w, h - ((v - min) / span) * (h - 4) - 2]);
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0]!.toFixed(1) + "," + p[1]!.toFixed(1)).join(" ");
  const last = pts[pts.length - 1]!;
  return (
    <svg width={w} height={h} style={{ display: "block", overflow: "visible" }}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2} fill={color} />
    </svg>
  );
}
