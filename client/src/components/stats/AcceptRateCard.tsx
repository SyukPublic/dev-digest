/* AcceptRateCard — a summary card showing accept-rate as a CircularScore gauge.
   Shared by all three stats surfaces (dashboard + both Stats tabs). A null rate
   (no acted findings) renders "—", never a "0%" gauge (AC-8). The gauge carries
   an accessible label (AC-36). */
import React from "react";
import { CircularScore } from "@devdigest/ui";
import { formatAcceptRate } from "@/lib/format";

export function AcceptRateCard({
  label,
  rate,
}: {
  label: string;
  /** accept-rate in 0..1, or null when no findings were acted on. */
  rate: number | null;
}) {
  const text = formatAcceptRate(rate);
  return (
    <div
      style={{
        flex: 1,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 9,
        padding: 18,
      }}
    >
      <span
        style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.03em" }}
      >
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12 }}>
        {rate == null ? (
          <span className="tnum" style={{ fontSize: 32, fontWeight: 700, color: "var(--text-muted)" }}>
            —
          </span>
        ) : (
          <>
            <div role="img" aria-label={`${label}: ${text}`}>
              <CircularScore score={Math.round(rate * 100)} size={48} />
            </div>
            <span className="tnum" style={{ fontSize: 28, fontWeight: 700 }}>
              {text}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
