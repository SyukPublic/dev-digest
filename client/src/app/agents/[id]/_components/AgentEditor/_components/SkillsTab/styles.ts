import type { CSSProperties } from "react";

/** Co-located styles for the Agent Editor's Skills tab. */
export const s = {
  wrap: { maxWidth: 820 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12, marginBottom: 6 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  hint: { fontSize: 13, color: "var(--text-secondary)", margin: "0 0 16px" } satisfies CSSProperties,
  search: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    width: 200,
  } satisfies CSSProperties,
  searchInput: {
    flex: 1,
    fontSize: 13,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  row: (on: boolean, dragging: boolean, disabled = false): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    marginBottom: 8,
    borderRadius: 8,
    border: "1px solid " + (on ? "var(--border-strong)" : "var(--border)"),
    background: on ? "var(--bg-hover)" : "var(--bg-elevated)",
    opacity: dragging ? 0.5 : disabled ? 0.55 : 1,
  }),
  name: { flex: 1, fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
} as const;
