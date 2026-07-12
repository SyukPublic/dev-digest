/* SkillCompareModal — read-only run-to-run compare for skill DIFFERENTIAL runs.
   Mirrors the agent CompareModal: four delta tiles (recall/precision/citation/cost)
   with direction shown by icon + TEXT (never colour alone), then a SKILL-BODY diff
   (from `diffLines`) instead of a system-prompt diff. Each run's host agent + version
   is shown; when the two runs used a different host (or host version) a confounder
   banner warns the delta may be misleading (AC-29). A missing skill_versions body
   degrades to "body unavailable" and a missing host name to "host unavailable"
   (AC-28) — never an error. Footer is Close only. Focus trap comes from Modal. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Button, Icon } from "@devdigest/ui";
import type { EvalSkillSuiteRun } from "@devdigest/shared";
import { useCompareSkillRuns } from "@/lib/hooks/eval";
import { fmtPct, fmtDeltaPts, deltaDirection, diffLines, type Direction } from "../helpers";

export function SkillCompareModal({ a, b, onClose }: { a: string; b: string; onClose: () => void }) {
  const t = useTranslations("eval");
  const { data, isLoading } = useCompareSkillRuns(a, b);

  const title = data
    ? `${t("skillCompare.title")} · ${t("skillCompare.arrow", {
        a: `v${data.run_a.skill_version}`,
        b: `v${data.run_b.skill_version}`,
      })}`
    : t("skillCompare.title");

  const footer = (
    <div style={{ display: "flex", justifyContent: "flex-end", width: "100%" }}>
      <Button kind="secondary" size="sm" onClick={onClose}>{t("skillCompare.close")}</Button>
    </div>
  );

  return (
    <Modal width={760} title={title} onClose={onClose} footer={footer}>
      {isLoading || !data ? (
        <div style={{ color: "var(--text-muted)" }}>{t("dashboard.loading")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {data.host_changed && (
            <div
              role="alert"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 14px",
                borderRadius: 8,
                border: "1px solid var(--warn)",
                background: "var(--warn-bg, rgba(234,179,8,0.10))",
                color: "var(--warn)",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <Icon.AlertTriangle size={15} />
              {t("skillCompare.hostChanged")}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12 }}>
            <DeltaTile label={t("skillCompare.metrics.recall")} value={fmtPct(data.run_b.recall)} delta={data.delta.recall} />
            <DeltaTile label={t("skillCompare.metrics.precision")} value={fmtPct(data.run_b.precision)} delta={data.delta.precision} />
            <DeltaTile label={t("skillCompare.metrics.citation")} value={fmtPct(data.run_b.citation_accuracy)} delta={data.delta.citation_accuracy} />
            <DeltaTile
              label={t("skillCompare.metrics.cost")}
              value={data.run_b.cost_usd == null ? "—" : `$${data.run_b.cost_usd.toFixed(2)}`}
              deltaText={data.delta.cost_usd == null ? "" : `${data.delta.cost_usd >= 0 ? "+" : ""}$${data.delta.cost_usd.toFixed(2)}`}
              direction={deltaDirection(data.delta.cost_usd)}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <HostCell run={data.run_a} tone="var(--crit)" />
            <HostCell run={data.run_b} tone="var(--ok)" />
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", color: "var(--text-muted)" }}>
                {t("skillCompare.bodyDiff").toUpperCase()}
              </span>
              <span style={{ display: "inline-flex", gap: 10, fontSize: 12, color: "var(--text-muted)" }}>
                <LegendDot color="var(--crit)" label={`v${data.run_a.skill_version} ${t("skillCompare.legendOld")}`} />
                <LegendDot color="var(--ok)" label={`v${data.run_b.skill_version} ${t("skillCompare.legendNew")}`} />
              </span>
            </div>
            {data.skill_body_a != null && data.skill_body_b != null ? (
              <BodyDiff a={data.skill_body_a} b={data.skill_body_b} />
            ) : (
              <div style={{ padding: "12px 14px", border: "1px dashed var(--border)", borderRadius: 8, color: "var(--text-muted)", fontStyle: "italic" }}>
                {t("skillCompare.bodyUnavailable")}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function HostCell({ run, tone }: { run: EvalSkillSuiteRun; tone: string }) {
  const t = useTranslations("eval");
  return (
    <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 9, padding: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.03em", color: "var(--text-muted)" }}>
        {t("skillCompare.host")}
      </div>
      <div style={{ marginTop: 4, fontSize: 13, fontWeight: 600, color: tone }}>
        {run.host_agent_name == null
          ? t("skillCompare.hostUnavailable")
          : `${run.host_agent_name} · v${run.host_agent_version}`}
      </div>
    </div>
  );
}

function DeltaTile({
  label,
  value,
  delta,
  deltaText,
  direction,
}: {
  label: string;
  value: string;
  delta?: number | null;
  deltaText?: string;
  direction?: Direction;
}) {
  const t = useTranslations("eval");
  const dir = direction ?? deltaDirection(delta ?? null);
  const DirIcon = dir === "up" ? Icon.ArrowUp : dir === "down" ? Icon.ArrowDown : Icon.Slash;
  const color = dir === "flat" ? "var(--text-muted)" : dir === "up" ? "var(--ok)" : "var(--crit)";
  const text = deltaText ?? fmtDeltaPts(delta ?? null);
  return (
    <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 9, padding: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.03em", color: "var(--text-muted)" }}>{label}</div>
      <div className="tnum" style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{value}</div>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 4, fontSize: 12, fontWeight: 600, color }}>
        <DirIcon size={12} />
        <span>{text || t(`skillCompare.${dir}`)}</span>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: "inline-block" }} />
      {label}
    </span>
  );
}

function BodyDiff({ a, b }: { a: string; b: string }) {
  const lines = React.useMemo(() => diffLines(a, b), [a, b]);
  return (
    <pre style={{ margin: 0, padding: 12, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 8, overflow: "auto", maxHeight: 260, fontSize: 12 }}>
      {lines.map((l, i) => (
        <div
          key={i}
          style={{
            background: l.kind === "add" ? "var(--ok-bg, rgba(34,197,94,0.12))" : l.kind === "del" ? "var(--crit-bg, rgba(239,68,68,0.12))" : "transparent",
            color: l.kind === "ctx" ? "var(--text-secondary)" : "var(--text)",
            whiteSpace: "pre-wrap",
          }}
        >
          {l.kind === "add" ? "+ " : l.kind === "del" ? "- " : "  "}
          {l.text}
        </div>
      ))}
    </pre>
  );
}
