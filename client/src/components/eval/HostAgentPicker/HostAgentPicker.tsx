/* HostAgentPicker — a compact, labelled host-agent selector for skill evals. A
   skill has no model/prompt, so it is scored as a DELTA on a host agent's review;
   this control picks that host. It preselects `default_host_id` (the first enabled
   agent that links the skill), falls back to the full enabled-agent list when none
   link, and disables itself with a reason when zero enabled agents exist (AC-4,
   AC-6). Rendered as a native <select> so it is keyboard-operable and labelled by
   default (the vendored SelectInput carries no disabled/label affordance). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { useSkillEvalHosts } from "@/lib/hooks/eval";

let uid = 0;

export function HostAgentPicker({
  skillId,
  value,
  onChange,
  disabled = false,
}: {
  skillId: string;
  /** Currently selected host id (controlled), or null before a default resolves. */
  value: string | null;
  onChange: (hostAgentId: string) => void;
  /** External disable (e.g. while a suite is running). */
  disabled?: boolean;
}) {
  const t = useTranslations("eval");
  const { data } = useSkillEvalHosts(skillId);
  const selectId = React.useMemo(() => `host-picker-${(uid += 1)}`, []);

  const candidates = data?.candidates ?? [];
  const enabled = candidates.filter((c) => c.enabled);
  // Preselect the server's default when it links the skill, else the first
  // enabled agent (all-enabled fallback when none link — AC-4/AC-6).
  const defaultId = data?.default_host_id ?? enabled[0]?.id ?? null;
  const noHost = enabled.length === 0;

  // Auto-select the resolved default once, so the parent always has a host to
  // run on without an extra click. Only fires while nothing is chosen yet.
  React.useEffect(() => {
    if (!value && defaultId) onChange(defaultId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run when the resolved default lands; onChange identity is not part of the trigger
  }, [value, defaultId]);

  const label = t("hostPicker.label");

  if (noHost) {
    return (
      <div style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
        <span id={`${selectId}-label`} style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
          {label}
        </span>
        <span
          role="note"
          aria-labelledby={`${selectId}-label`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 12px",
            borderRadius: 7,
            border: "1px dashed var(--border)",
            color: "var(--text-muted)",
            fontSize: 13,
          }}
        >
          <Icon.AlertTriangle size={13} />
          {t("hostPicker.noEnabledHost")}
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <label htmlFor={selectId} style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
        {label}
      </label>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderRadius: 7,
          border: "1px solid var(--border-strong)",
          background: "var(--bg-elevated)",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <select
          id={selectId}
          aria-label={label}
          value={value ?? defaultId ?? ""}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          style={{
            fontSize: 13,
            color: "var(--text-primary)",
            background: "transparent",
            border: "none",
            outline: "none",
            appearance: "none",
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          {enabled.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {t("hostPicker.versionSuffix", { version: c.version })}
            </option>
          ))}
        </select>
        <Icon.ChevronsUpDown size={13} style={{ color: "var(--text-muted)", pointerEvents: "none" }} />
      </div>
    </div>
  );
}
