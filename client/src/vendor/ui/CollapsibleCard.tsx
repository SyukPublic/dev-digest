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
  /**
   * Title font size in px. Additive, backward-compatible — defaults to 14 (the
   * original hardcoded size), so existing consumers are unchanged. A caller may
   * pass 13 for a slightly smaller (still bold) title (R4 RISK AREAS rows).
   */
  titleSize?: number;
  /**
   * Compact header variant. Additive, default false → unchanged. When true the
   * header uses tighter padding + a smaller icon container so the whole control
   * reads as a badge-sized affordance (R5.1 "How this is built" info control),
   * while keeping the same expander semantics (whole header toggles,
   * `aria-expanded`, chevron).
   */
  compact?: boolean;
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
  titleSize = 14,
  compact = false,
  children,
}: CollapsibleCardProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const I = Icon[icon];
  const toggle = React.useCallback(() => setOpen((o) => !o), []);

  // Compact tightens header padding + shrinks the icon container so the control
  // reads as a badge-sized affordance; defaults keep the original dimensions.
  const headerPad = compact ? "5px 9px" : "12px 14px";
  const iconBox = compact ? 20 : 28;
  const iconSize = compact ? 12 : 15;
  const headerGap = compact ? 8 : 12;

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
          gap: headerGap,
          width: "100%",
          padding: headerPad,
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
            width: iconBox,
            height: iconBox,
            borderRadius: 99,
            flexShrink: 0,
            color,
            background: "color-mix(in srgb, currentColor 16%, transparent)",
          }}
        >
          <I size={iconSize} />
        </span>
        <span style={{ fontSize: titleSize, fontWeight: 600, color: "var(--text-primary)" }}>{title}</span>
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
