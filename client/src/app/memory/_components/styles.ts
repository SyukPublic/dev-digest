import type { CSSProperties } from "react";

/** Co-located styles for the Memory three-pane view (theme via CSS vars only). */
export const s = {
  page: { padding: "20px 28px 40px", maxWidth: 1280, margin: "0 auto" } satisfies CSSProperties,
  headerRow: { display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  searchRow: { display: "flex", alignItems: "center", gap: 10, margin: "14px 0 18px" } satisfies CSSProperties,
  searchGrow: { flex: 1 } satisfies CSSProperties,

  panes: {
    display: "grid",
    gridTemplateColumns: "220px minmax(0, 1fr) 360px",
    gap: 18,
    alignItems: "start",
  } satisfies CSSProperties,

  // Left rail
  rail: { display: "flex", flexDirection: "column", gap: 20 } satisfies CSSProperties,
  railSection: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  railRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  } satisfies CSSProperties,
  railCount: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,

  // Center list
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  card: (selected: boolean): CSSProperties => ({
    textAlign: "left",
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid " + (selected ? "var(--accent)" : "var(--border)"),
    background: selected ? "var(--accent-bg)" : "var(--bg-elevated)",
    cursor: "pointer",
  }),
  cardTop: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  cardGrow: { flex: 1 } satisfies CSSProperties,
  cardContent: { fontSize: 14, color: "var(--text-primary)", lineHeight: 1.5 } satisfies CSSProperties,
  cardBottom: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  chips: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" } satisfies CSSProperties,
  usedDate: { fontSize: 12, color: "var(--text-muted)", marginLeft: "auto" } satisfies CSSProperties,

  // Right detail
  detail: {
    position: "sticky",
    top: 16,
    display: "flex",
    flexDirection: "column",
    gap: 14,
    padding: 18,
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  detailTop: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  detailActions: { display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" } satisfies CSSProperties,
  detailContent: { fontSize: 15, color: "var(--text-primary)", lineHeight: 1.6 } satisfies CSSProperties,
  metaRow: {
    fontSize: 12,
    color: "var(--text-muted)",
    letterSpacing: "0.03em",
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  } satisfies CSSProperties,
  sourceCard: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg)",
  } satisfies CSSProperties,

  banner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    borderRadius: 8,
    background: "var(--crit-bg)",
    color: "var(--crit)",
    fontSize: 13,
    marginBottom: 12,
  } satisfies CSSProperties,

  formField: { display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  formRow: { display: "flex", gap: 12 } satisfies CSSProperties,
  formError: { fontSize: 12, color: "var(--crit)" } satisfies CSSProperties,
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0,0,0,0)",
    whiteSpace: "nowrap",
    border: 0,
  } satisfies CSSProperties,
} as const;
