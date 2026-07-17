import type { CSSProperties } from "react";

const btnBase: CSSProperties = {
  padding: "6px 12px",
  fontSize: 13,
  fontWeight: 600,
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--bg-elevated)",
  color: "var(--text-secondary)",
  cursor: "pointer",
};

export const s: Record<string, CSSProperties> = {
  group: { display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" },
  buttons: { display: "flex", gap: 6 },
  btn: btnBase,
  btnActive: {
    ...btnBase,
    color: "var(--text-primary)",
    // Use the `border` shorthand (NOT standalone `borderColor`) so it matches
    // `btnBase`'s shorthand — mixing the two makes React warn "Removing a style
    // property (borderColor) when a conflicting property (border) is set" as the
    // active button toggles back to inactive on a period switch.
    border: "1px solid var(--accent)",
    background: "var(--bg-hover)",
  },
  range: { display: "flex", gap: 8, alignItems: "flex-end" },
  field: { display: "flex", flexDirection: "column", gap: 2 },
  fieldLabel: { fontSize: 11, color: "var(--text-muted)" },
  input: {
    padding: "5px 8px",
    fontSize: 13,
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
  },
};
