/* RunHistoryTable — the per-agent run-history table (AC-27). Timestamp, PR,
   tokens, cost ("—" on null), findings, source (local/CI badge), and a "View
   trace" action opening the existing RunTraceDrawer by run_id (AC-35). PR number
   renders as escaped text (the AgentStats row carries no repo slug for a
   github.com deep-link). */
import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { AgentRunHistoryRow } from "@devdigest/shared";
import { formatCost } from "@/lib/format";
import { s } from "./styles";

function formatTs(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function RunHistoryTable({
  rows,
  onViewTrace,
}: {
  rows: AgentRunHistoryRow[];
  onViewTrace: (runId: string) => void;
}) {
  const t = useTranslations("agents");
  return (
    <div style={s.table} role="table" aria-label={t("stats.history.title")}>
      <div style={s.headRow} role="row">
        <span role="columnheader">{t("stats.history.timestamp")}</span>
        <span role="columnheader">{t("stats.history.pr")}</span>
        <span role="columnheader">{t("stats.history.tokens")}</span>
        <span role="columnheader">{t("stats.history.cost")}</span>
        <span role="columnheader">{t("stats.history.findings")}</span>
        <span role="columnheader">{t("stats.history.source")}</span>
        <span role="columnheader">{t("stats.history.viewTrace")}</span>
      </div>
      {rows.map((r) => (
        <div key={r.run_id} style={s.row} role="row">
          <span role="cell" style={s.muted}>
            {formatTs(r.ran_at)}
          </span>
          <span role="cell">{r.pr_number != null ? `#${r.pr_number}` : <span style={s.muted}>—</span>}</span>
          <span role="cell" className="tnum">
            {r.tokens != null ? r.tokens.toLocaleString("en-US") : <span style={s.muted}>—</span>}
          </span>
          <span role="cell" className="tnum">
            {formatCost(r.cost_usd)}
          </span>
          <span role="cell" className="tnum">
            {r.findings_count != null ? r.findings_count : <span style={s.muted}>—</span>}
          </span>
          <span role="cell">
            <Badge>{r.source === "ci" ? t("stats.source.ci") : t("stats.source.local")}</Badge>
          </span>
          <button type="button" style={s.traceBtn} onClick={() => onViewTrace(r.run_id)}>
            {t("stats.history.viewTrace")}
          </button>
        </div>
      ))}
    </div>
  );
}
