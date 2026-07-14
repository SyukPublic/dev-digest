import type React from "react";

export const s: Record<string, React.CSSProperties> = {
  wrap: { marginTop: 32 },
  toggle: { display: "inline-flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-secondary)", cursor: "pointer" },
  list: { display: "flex", flexDirection: "column", gap: 12 },
  card: { background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, padding: 14 },
  cardHead: { display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12, flexWrap: "wrap" },
  loc: { fontSize: 12.5, color: "var(--text-muted)" },
  title: { fontSize: 14, fontWeight: 600, color: "var(--text-primary)" },
  takes: { display: "flex", flexDirection: "column", gap: 8 },
  take: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" },
  persona: { fontSize: 13, fontWeight: 500, color: "var(--text-primary)", minWidth: 120 },
  note: { fontSize: 13, color: "var(--text-secondary)", flex: 1, minWidth: 0 },
};
