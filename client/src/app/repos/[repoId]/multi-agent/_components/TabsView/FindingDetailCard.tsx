/* FindingDetailCard — one agent's finding in the Tabs view. Collapsed: severity
   icon + title + category + file:line + confidence. Expanded: rationale, a
   suggested-fix block, and the action row (Accept / Dismiss / Learn / Turn into
   eval case). A lethal_trifecta finding shows the "ALL 3 PRESENT" venn badge with
   its three component checks before the rationale. Presentational — the parent
   (TabsView) owns the mutations. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  CategoryTag,
  ConfidenceNum,
  Icon,
  Markdown,
  SeverityBadge,
  type Category,
  type Severity,
} from "@devdigest/ui";
import type { FindingRecord, TrifectaComponent } from "@devdigest/shared";
import { s } from "./styles";

const TRIFECTA_ORDER: TrifectaComponent[] = [
  "private_data_access",
  "untrusted_input",
  "exfil_path",
];

export function FindingDetailCard({
  f,
  pending,
  evalCasePending,
  onAccept,
  onDismiss,
  onLearn,
  onTurnIntoEvalCase,
}: {
  f: FindingRecord;
  pending?: boolean;
  evalCasePending?: boolean;
  onAccept: () => void;
  onDismiss: () => void;
  onLearn: () => void;
  onTurnIntoEvalCase: () => void;
}) {
  const t = useTranslations("runs");
  const [expanded, setExpanded] = React.useState(false);
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const isTrifecta = f.kind === "lethal_trifecta";
  const present = new Set(f.trifecta_components ?? []);

  return (
    <div style={s.card}>
      <button type="button" style={s.cardHead} onClick={() => setExpanded((e) => !e)}>
        <SeverityBadge severity={f.severity as Severity} compact />
        <span style={s.cardTitle}>{f.title}</span>
        <CategoryTag category={f.category as Category} />
        <span className="mono" style={s.cardLoc}>
          {f.file}:{f.start_line}
        </span>
        <span style={s.spacer} />
        <ConfidenceNum value={f.confidence} />
        <Icon.ChevronDown size={16} style={{ color: "var(--text-muted)", transform: expanded ? "rotate(180deg)" : undefined }} />
      </button>

      {expanded && (
        <div style={s.cardBody}>
          {isTrifecta && (
            <div style={s.trifecta}>
              <div style={s.trifectaTitle}>
                <Icon.AlertOctagon size={14} style={{ color: "var(--crit)" }} />
                {t("tabs.trifectaTitle")}
              </div>
              <div style={s.trifectaChecks}>
                {TRIFECTA_ORDER.map((comp) => (
                  <span key={comp} style={s.trifectaCheck(present.has(comp))}>
                    <Icon.Check size={12} />
                    {t(`tabs.trifecta.${comp}`)}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div style={s.prose}>
            <Markdown>{f.rationale}</Markdown>
          </div>

          {f.suggestion && (
            <div style={s.suggestion}>
              <div style={s.suggestionLabel}>{t("tabs.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{f.suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions}>
            <Button kind="secondary" size="sm" icon="Check" active={accepted} disabled={pending} onClick={onAccept}>
              {t("tabs.accept")}
            </Button>
            <Button kind="ghost" size="sm" icon="X" active={dismissed} disabled={pending} onClick={onDismiss}>
              {t("tabs.dismiss")}
            </Button>
            {/* Learn is a stub — no Memory subsystem yet (AC-25). */}
            <Button kind="ghost" size="sm" icon="Sparkles" disabled onClick={onLearn}>
              {t("tabs.learn")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="FlaskConical"
              disabled={(!accepted && !dismissed) || !!evalCasePending}
              onClick={onTurnIntoEvalCase}
            >
              {t("tabs.turnIntoEvalCase")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
