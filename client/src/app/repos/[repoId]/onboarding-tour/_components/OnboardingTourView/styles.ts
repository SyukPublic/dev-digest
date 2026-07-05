import type { CSSProperties } from "react";

/** Co-located styles for the Onboarding Tour page (TOC + section-card layout). */
export const s = {
  /* Page layout: sticky TOC left, content column right. */
  wrap: { display: "flex", gap: 32, alignItems: "flex-start", padding: "24px 28px" } satisfies CSSProperties,
  toc: {
    width: 200,
    flexShrink: 0,
    position: "sticky",
    top: 76,
    alignSelf: "flex-start",
  } satisfies CSSProperties,
  content: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,

  /* Header block. */
  header: { display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 4 } satisfies CSSProperties,
  h1: { fontSize: 22, fontWeight: 700, color: "var(--text-primary)", margin: 0, letterSpacing: "-0.01em" } satisfies CSSProperties,
  h1Repo: { color: "var(--accent-text)" } satisfies CSSProperties,
  metaLine: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 6,
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  actions: { marginLeft: "auto", display: "flex", gap: 8, flexShrink: 0 } satisfies CSSProperties,

  /* reading_path rows. */
  pathRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "10px 0",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  pathBadge: {
    display: "inline-grid",
    placeItems: "center",
    width: 24,
    height: 24,
    borderRadius: 99,
    flexShrink: 0,
    fontSize: 12,
    fontWeight: 700,
    color: "#fff",
    background: "var(--accent)",
  } satisfies CSSProperties,
  pathBody: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  pathPath: { fontSize: 13, color: "var(--text-primary)", fontWeight: 600 } satisfies CSSProperties,
  pathRationale: { fontSize: 13, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,

  /* getting_started command rows. */
  cmdRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 12px",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    marginBottom: 8,
  } satisfies CSSProperties,
  cmdStep: { fontSize: 12, fontWeight: 700, color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  cmd: { flex: 1, minWidth: 0, fontSize: 13, color: "var(--text-primary)", whiteSpace: "pre-wrap", wordBreak: "break-word" } satisfies CSSProperties,

  /* first_tasks link list. */
  linkList: { display: "flex", flexDirection: "column", gap: 6, marginTop: 10 } satisfies CSSProperties,
  linkRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 13 } satisfies CSSProperties,

  skeletonStack: { display: "flex", flexDirection: "column", gap: 16, padding: "24px 28px" } satisfies CSSProperties,
} as const;
