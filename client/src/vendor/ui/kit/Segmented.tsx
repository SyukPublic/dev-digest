import React from "react";

/** Small segmented mode switcher (e.g. Preview | Edit). Tablist semantics —
 *  each option is a `role="tab"` button; the active one gets `aria-selected`. */
export function Segmented({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{
        display: "inline-flex",
        gap: 4,
        background: "var(--bg-elevated)",
        padding: 3,
        borderRadius: 7,
        border: "1px solid var(--border)",
      }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            style={{
              padding: "4px 12px",
              borderRadius: 5,
              border: "none",
              background: on ? "var(--bg-surface)" : "transparent",
              color: on ? "var(--text-primary)" : "var(--text-secondary)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
