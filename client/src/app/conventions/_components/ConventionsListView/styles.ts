import type { CSSProperties } from "react";

/** Co-located styles for ConventionsListView (mirrors SkillsListView). */
export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 980, margin: "0 auto" } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12, marginBottom: 8 } satisfies CSSProperties,
  headerText: { flex: 1 } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  repo: { color: "var(--accent)", fontFamily: "var(--font-mono)" } satisfies CSSProperties,
  subtitle: { fontSize: 14, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    margin: "12px 0 16px",
  } satisfies CSSProperties,
  count: { fontSize: 13, color: "var(--text-muted)", flex: 1 } satisfies CSSProperties,
  group: { marginBottom: 22 } satisfies CSSProperties,
  groupTitle: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    margin: "0 0 10px",
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
} as const;
