/* ConflictsBlock — "Where agents disagree" (AC-20/22/23). Renders every grouped
   location the server returns; the "Show only conflicts" toggle narrows to real
   disagreements (divergent verdicts, counting the synthesized `ignored` = "did
   not flag" take). Empty conflicts ⇒ the agents-agree empty state (AC-37). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, EmptyState, SectionLabel, Toggle, SEV, type Severity } from "@devdigest/ui";
import type { Conflict, ConflictTake } from "@devdigest/shared";
import { isDisagreement } from "../../helpers";
import { s } from "./styles";

function TakeVerdictBadge({ verdict }: { verdict: ConflictTake["verdict"] }) {
  const t = useTranslations("runs");
  if (verdict === "ignored") {
    return (
      <Badge color="var(--text-muted)" dot>
        {t("conflicts.didNotFlag")}
      </Badge>
    );
  }
  const sev = SEV[verdict as Severity];
  return (
    <Badge color={sev.c} bg={sev.bg} icon={sev.icon}>
      {sev.label}
    </Badge>
  );
}

export function ConflictsBlock({ conflicts }: { conflicts: Conflict[] }) {
  const t = useTranslations("runs");
  const [onlyConflicts, setOnlyConflicts] = React.useState(false);

  const shown = onlyConflicts ? conflicts.filter(isDisagreement) : conflicts;

  return (
    <section style={s.wrap}>
      <SectionLabel
        icon="Zap"
        right={
          <label style={s.toggle}>
            {t("conflicts.onlyConflicts")}
            <Toggle on={onlyConflicts} onChange={setOnlyConflicts} size={16} />
          </label>
        }
      >
        {t("conflicts.title")}
      </SectionLabel>

      {shown.length === 0 ? (
        <EmptyState icon="Check" title={t("conflicts.empty")} />
      ) : (
        <div style={s.list}>
          {shown.map((c) => (
            <div key={`${c.file}:${c.line}:${c.title}`} style={s.card}>
              <div style={s.cardHead}>
                <span className="mono" style={s.loc}>
                  {c.file}:{c.line}
                </span>
                <span style={s.title}>{c.title}</span>
              </div>
              <div style={s.takes}>
                {c.takes.map((tk) => (
                  <div key={tk.agent_id} style={s.take}>
                    <span style={s.persona}>{tk.persona}</span>
                    <TakeVerdictBadge verdict={tk.verdict} />
                    {tk.note && <span style={s.note}>{tk.note}</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
