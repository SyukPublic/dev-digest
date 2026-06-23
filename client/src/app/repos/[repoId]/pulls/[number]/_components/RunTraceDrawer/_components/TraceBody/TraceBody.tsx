/* TraceBody — the Trace tab content: Configuration, Stats, Findings, Prompt
   assembly, Tool calls, and Raw output sections for one persisted RunTrace. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { RunTrace, FindingRecord } from "@devdigest/shared";
import { PROMPT_COLORS } from "../../constants";
import { formatSeconds, formatTokens } from "../../helpers";
import { formatCost } from "@/lib/format";
import { s } from "../../styles";
import { TraceSection } from "../TraceSection";
import { ToolCallRow } from "../ToolCallRow";
import { PromptBlock } from "../PromptBlock";
import { FindingsSection } from "../FindingsSection";
import { Row, Stat } from "../atoms";

/** Local styles for the per-skill token breakdown under the Skills block. */
const SKILL_TOKENS = {
  wrap: { margin: "2px 0 8px 18px", borderLeft: "1px solid var(--border)", paddingLeft: 12 } as React.CSSProperties,
  head: { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)", margin: "6px 0 4px" } as React.CSSProperties,
  row: { display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, padding: "2px 0" } as React.CSSProperties,
  count: { color: "var(--text-muted)" } as React.CSSProperties,
};

export function TraceBody({ trace, findings }: { trace: RunTrace; findings: FindingRecord[] }) {
  const t = useTranslations("runs");
  const stats = trace.stats;
  return (
    <>
      <TraceSection icon="Settings" title={t("trace.configuration")}>
        <div style={s.configList}>
          <Row label={t("trace.config.model")}>
            <span className="mono" style={s.configModel}>
              {trace.config.model}
            </span>
          </Row>
          <Row label={t("trace.config.provider")}>
            <span className="mono" style={s.configProvider}>
              {trace.config.provider ?? "—"}
            </span>
          </Row>
          <Row label={t("trace.config.memoryPulled")}>
            <span>{t("trace.config.items", { count: trace.memory_pulled.length })}</span>
          </Row>
          <Row label={t("trace.config.specsRead")}>
            <div style={s.specsWrap}>
              {trace.specs_read.length === 0 ? (
                <span style={s.specsNone}>{t("trace.config.none")}</span>
              ) : (
                trace.specs_read.map((sp, i) => (
                  <span key={i} className="mono" style={s.spec}>
                    {sp}
                  </span>
                ))
              )}
            </div>
          </Row>
        </div>
      </TraceSection>

      <TraceSection
        icon="Gauge"
        title={t("trace.stats")}
        right={
          <Badge color="var(--ok)" bg="var(--ok-bg)" icon="Check">
            {stats.grounding}
          </Badge>
        }
      >
        <div style={s.statsRow}>
          <Stat label={t("trace.stat.duration")} val={formatSeconds(stats.duration_ms)} />
          <Stat label={t("trace.stat.tokens")} val={formatTokens(stats.tokens_in, stats.tokens_out)} />
          <Stat label={t("trace.stat.cost")} val={formatCost(stats.cost_usd)} />
          <Stat label={t("trace.stat.findings")} val={stats.findings} />
        </div>
      </TraceSection>

      <FindingsSection findings={findings} />

      <TraceSection icon="FileText" title={t("trace.promptAssembly")} defaultOpen={false}>
        {(() => {
          const tok = trace.prompt_assembly.tokens ?? undefined;
          const skillTokens = trace.prompt_assembly.skill_tokens ?? [];
          return (
            <>
              <PromptBlock label={t("trace.prompt.system")} text={trace.prompt_assembly.system} color={PROMPT_COLORS.system} tokens={tok?.system} />
              {trace.prompt_assembly.skills != null && (
                <PromptBlock
                  label={t("trace.prompt.skills")}
                  text={trace.prompt_assembly.skills}
                  color={PROMPT_COLORS.skills}
                  tokens={tok?.skills}
                  extra={
                    skillTokens.length > 0 ? (
                      <div style={SKILL_TOKENS.wrap}>
                        <div style={SKILL_TOKENS.head}>{t("trace.prompt.perSkill")}</div>
                        {skillTokens.map((sk, i) => (
                          <div key={i} style={SKILL_TOKENS.row}>
                            <span className="mono">{sk.name}</span>
                            <span style={SKILL_TOKENS.count}>{t("trace.prompt.tokens", { count: sk.tokens })}</span>
                          </div>
                        ))}
                      </div>
                    ) : undefined
                  }
                />
              )}
              {trace.prompt_assembly.memory != null && (
                <PromptBlock label={t("trace.prompt.memory")} text={trace.prompt_assembly.memory} color={PROMPT_COLORS.memory} tokens={tok?.memory} />
              )}
              {trace.prompt_assembly.repo_map != null && (
                <PromptBlock label={t("trace.prompt.repoMap")} text={trace.prompt_assembly.repo_map} color={PROMPT_COLORS.repoMap} tokens={tok?.repo_map} />
              )}
              {trace.prompt_assembly.specs != null && (
                <PromptBlock label={t("trace.prompt.specs")} text={trace.prompt_assembly.specs} color={PROMPT_COLORS.specs} tokens={tok?.specs} />
              )}
              {trace.prompt_assembly.callers != null && (
                <PromptBlock label={t("trace.prompt.callers")} text={trace.prompt_assembly.callers} color={PROMPT_COLORS.callers} tokens={tok?.callers} />
              )}
              <PromptBlock label={t("trace.prompt.user")} text={trace.prompt_assembly.user} color={PROMPT_COLORS.user} tokens={tok?.user} />
            </>
          );
        })()}
      </TraceSection>

      <TraceSection
        icon="Wrench"
        title={t("trace.toolCalls")}
        right={<Badge color="var(--text-muted)">{trace.tool_calls.length}</Badge>}
      >
        {trace.tool_calls.length === 0 ? (
          <span style={s.noToolCalls}>{t("trace.noToolCalls")}</span>
        ) : (
          trace.tool_calls.map((tc, i) => <ToolCallRow key={i} tc={tc} />)
        )}
      </TraceSection>

      <TraceSection icon="Code" title={t("trace.rawOutput")} defaultOpen={false}>
        <pre className="mono" style={s.rawPre}>
          {trace.raw_output || "—"}
        </pre>
      </TraceSection>
    </>
  );
}
