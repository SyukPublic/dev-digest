/* CompareModal — read-only run-to-run compare (Mockup 4). Four delta tiles
   (recall/precision/citation/cost) with direction shown by icon + TEXT (never
   color alone), plus a system-prompt diff block with old/new legend + added/
   removed highlighting. Footer is Close only — there is NO Promote control. A
   missing agent_versions row degrades to "config unavailable" (AC-28). Focus
   trap comes from Modal. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Button, Icon } from "@devdigest/ui";
import { useCompareRuns } from "@/lib/hooks/eval";
import { fmtPct, fmtDeltaPts, deltaDirection, diffLines, type Direction } from "../helpers";

export function CompareModal({ a, b, onClose }: { a: string; b: string; onClose: () => void }) {
  const t = useTranslations("eval");
  const { data, isLoading } = useCompareRuns(a, b);

  const title = data
    ? `${t("compare.title")} · ${t("compare.arrow", { a: `v${data.run_a.agent_version}`, b: `v${data.run_b.agent_version}` })}`
    : t("compare.title");

  const footer = (
    <div style={{ display: "flex", justifyContent: "flex-end", width: "100%" }}>
      <Button kind="secondary" size="sm" onClick={onClose}>{t("compare.close")}</Button>
    </div>
  );

  return (
    <Modal width={760} title={title} onClose={onClose} footer={footer}>
      {isLoading || !data ? (
        <div style={{ color: "var(--text-muted)" }}>{t("dashboard.loading")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12 }}>
            <DeltaTile label={t("compare.metrics.recall")} value={fmtPct(data.run_b.recall)} delta={data.delta.recall} />
            <DeltaTile label={t("compare.metrics.precision")} value={fmtPct(data.run_b.precision)} delta={data.delta.precision} />
            <DeltaTile label={t("compare.metrics.citation")} value={fmtPct(data.run_b.citation_accuracy)} delta={data.delta.citation_accuracy} />
            <DeltaTile
              label={t("compare.metrics.cost")}
              value={data.run_b.cost_usd == null ? "—" : `$${data.run_b.cost_usd.toFixed(2)}`}
              deltaText={data.delta.cost_usd == null ? "" : `${data.delta.cost_usd >= 0 ? "+" : ""}$${data.delta.cost_usd.toFixed(2)}`}
              direction={deltaDirection(data.delta.cost_usd)}
            />
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", color: "var(--text-muted)" }}>
                {t("compare.systemPromptDiff").toUpperCase()}
              </span>
              <span style={{ display: "inline-flex", gap: 10, fontSize: 12, color: "var(--text-muted)" }}>
                <LegendDot color="var(--crit)" label={`v${data.run_a.agent_version} ${t("compare.legendOld")}`} />
                <LegendDot color="var(--ok)" label={`v${data.run_b.agent_version} ${t("compare.legendNew")}`} />
              </span>
            </div>
            {data.config_available && data.system_prompt_a != null && data.system_prompt_b != null ? (
              <PromptDiff a={data.system_prompt_a} b={data.system_prompt_b} />
            ) : (
              <div style={{ padding: "12px 14px", border: "1px dashed var(--border)", borderRadius: 8, color: "var(--text-muted)", fontStyle: "italic" }}>
                {t("compare.configUnavailable")}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
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
        <span>{text || t(`compare.${dir}`)}</span>
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

function PromptDiff({ a, b }: { a: string; b: string }) {
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
