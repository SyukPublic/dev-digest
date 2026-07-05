/* CollapsibleCard — a keyboard-operable collapsible section card: a coloured
   round icon container + title + chevron header that toggles a body below it.
   A reusable sibling of the trace tab's private TraceSection. */
import React from "react";
import { Icon, type IconName } from "./icons";

export interface CollapsibleCardProps {
  /** Icon shown inside the coloured round container. */
  icon: IconName;
  /** Section title (semibold, light text). */
  title: string;
  /**
   * Accent colour for the round icon container (any CSS colour / var).
   * Defaults to the accent text token.
   */
  color?: string;
  /** Optional content rendered on the far right of the header, before the chevron. */
  right?: React.ReactNode;
  /** Whether the card starts expanded. */
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/**
 * A collapsible card whose whole header toggles the body — on click and via the
 * keyboard (Enter/Space), exposing `aria-expanded`. The chevron points up when
 * expanded and down when collapsed.
 */
export function CollapsibleCard({
  icon,
  title,
  color = "var(--accent-text)",
  right,
  defaultOpen = true,
  children,
}: CollapsibleCardProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const I = Icon[icon];
  const toggle = React.useCallback(() => setOpen((o) => !o), []);

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--bg-surface)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          width: "100%",
          padding: "12px 14px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          color: "inherit",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: "inline-grid",
            placeItems: "center",
            width: 28,
            height: 28,
            borderRadius: 99,
            flexShrink: 0,
            color,
            background: "color-mix(in srgb, currentColor 16%, transparent)",
          }}
        >
          <I size={15} />
        </span>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{title}</span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {right}
          <Icon.ChevronDown
            size={16}
            aria-hidden="true"
            style={{
              color: "var(--text-muted)",
              transform: open ? "rotate(180deg)" : "none",
              transition: "transform .15s ease",
            }}
          />
        </span>
      </button>
      {open && <div style={{ padding: "0 14px 14px 14px" }}>{children}</div>}
    </div>
  );
}
