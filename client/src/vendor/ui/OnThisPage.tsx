/* OnThisPage — a generic in-page table-of-contents nav. Renders a small
   uppercase label + a vertical stack of anchor links; the active section
   (tracked via IntersectionObserver, with a scroll fallback) gets an accent
   rule, light text, and `aria-current`. A polite live region announces the
   active section for screen readers. Keyboard-navigable via native anchors. */
import React from "react";

export interface OnThisPageAnchor {
  /** Target element id (without `#`). */
  id: string;
  /** Visible link text. */
  label: string;
}

export interface OnThisPageProps {
  /** The section anchors, in document order. */
  anchors: OnThisPageAnchor[];
  /** Small uppercase heading above the list (e.g. "On this page"). */
  label: string;
  /**
   * Optional controlled active id. When omitted, the component tracks the
   * active section itself via IntersectionObserver on the anchor targets.
   */
  activeId?: string;
  /**
   * Template for the screen-reader announcement of the active section.
   * Receives the active anchor's label. Defaults to the label itself.
   */
  announce?: (activeLabel: string) => string;
}

/** In-page TOC with an IntersectionObserver-tracked active anchor. */
export function OnThisPage({ anchors, label, activeId, announce }: OnThisPageProps) {
  const [observed, setObserved] = React.useState<string>(activeId ?? anchors[0]?.id ?? "");
  const controlled = activeId !== undefined;
  const active = controlled ? activeId : observed;

  React.useEffect(() => {
    if (controlled || typeof IntersectionObserver === "undefined") return;
    const targets = anchors
      .map((a) => document.getElementById(a.id))
      .filter((el): el is HTMLElement => el != null);
    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) setObserved(visible.target.id);
      },
      { rootMargin: "0px 0px -60% 0px", threshold: 0.1 },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [anchors, controlled]);

  const activeLabel = anchors.find((a) => a.id === active)?.label ?? "";

  return (
    <nav aria-label={label}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          marginBottom: 12,
        }}
      >
        {label}
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
        {anchors.map((a) => {
          const isActive = a.id === active;
          return (
            <li key={a.id}>
              <a
                href={`#${a.id}`}
                aria-current={isActive ? "location" : undefined}
                style={{
                  display: "block",
                  padding: "6px 12px",
                  fontSize: 13,
                  textDecoration: "none",
                  borderLeft: `2px solid ${isActive ? "var(--accent-text)" : "transparent"}`,
                  color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                  fontWeight: isActive ? 600 : 400,
                  transition: "color .12s",
                }}
              >
                {a.label}
              </a>
            </li>
          );
        })}
      </ul>
      <div aria-live="polite" className="sr-only" style={SR_ONLY}>
        {activeLabel ? (announce ? announce(activeLabel) : activeLabel) : ""}
      </div>
    </nav>
  );
}

/** Visually-hidden style for the live-region announcement. */
const SR_ONLY: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};
