/* DeltaFindings — the list of findings a SKILL added on a case (the delta arm of
   a differential run). Each row shows a severity·category chip, the file:line, the
   finding title, and a caught / noise / ignored classification tag. The tag ALWAYS
   carries TEXT (not colour alone) so it is not colour-only information (AC-30). An
   empty delta renders explanatory copy (AC-15). Pure/presentational — the delta is
   read from a persisted `eval_runs.actual_output` (EvalSkillCaseDelta). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge } from "@devdigest/ui";
import type { EvalSkillCaseDelta, EvalSkillDeltaClassification } from "@devdigest/shared";

type DeltaFinding = EvalSkillCaseDelta["findings"][number];

/** Glyph + colour token per classification — the text label comes from i18n. */
const CLASSIFICATION: Record<
  EvalSkillDeltaClassification,
  { Glyph: typeof Icon.CheckCircle; color: string }
> = {
  caught: { Glyph: Icon.CheckCircle, color: "var(--ok)" },
  noise: { Glyph: Icon.XCircle, color: "var(--crit)" },
  ignored: { Glyph: Icon.AlertTriangle, color: "var(--warn)" },
};

export function DeltaFindings({ delta }: { delta: EvalSkillCaseDelta | null | undefined }) {
  const t = useTranslations("eval");
  const findings = delta?.findings ?? [];

  if (findings.length === 0) {
    return (
      <div
        role="status"
        style={{
          padding: "14px 16px",
          border: "1px dashed var(--border)",
          borderRadius: 8,
          color: "var(--text-muted)",
          fontSize: 13,
          fontStyle: "italic",
        }}
      >
        {t("delta.empty")}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{t("delta.heading")}</div>
      {findings.map((f, i) => (
        <DeltaRow key={i} finding={f} />
      ))}
    </div>
  );
}

function DeltaRow({ finding }: { finding: DeltaFinding }) {
  const t = useTranslations("eval");
  const cls = CLASSIFICATION[finding.classification];
  const ClsIcon = cls.Glyph;
  const chip = [finding.severity, finding.category].filter(Boolean).join("·");

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        border: "1px solid var(--border)",
        borderRadius: 9,
        background: "var(--bg-surface)",
      }}
    >
      {chip && <Badge color="var(--text-secondary)">{chip}</Badge>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {finding.title || t("delta.location", { file: finding.file, line: finding.start_line })}
        </div>
        <div className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {t("delta.location", { file: finding.file, line: finding.start_line })}
        </div>
      </div>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: cls.color,
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        <ClsIcon size={14} />
        {t(`delta.${finding.classification}`)}
      </span>
    </div>
  );
}
