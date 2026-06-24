/* ConventionCard — one extracted convention: rule, evidence (path + snippet),
   confidence bar, source/category badges, and accept/reject + inline edit. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon, ProgressBar, Textarea } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { confidenceColor } from "../ConventionsListView/helpers";
import { s } from "./styles";

export interface ConventionEditPatch {
  rule: string;
  evidence_snippet: string;
}

export function ConventionCard({
  candidate,
  onAccept,
  onReject,
  onSaveEdit,
  busy,
}: {
  candidate: ConventionCandidate;
  onAccept: () => void;
  onReject: () => void;
  onSaveEdit: (patch: ConventionEditPatch) => void;
  busy?: boolean;
}) {
  const t = useTranslations("conventions");
  const [editing, setEditing] = React.useState(false);
  const [rule, setRule] = React.useState(candidate.rule);
  const [snippet, setSnippet] = React.useState(candidate.evidence_snippet);
  const pct = Math.round(candidate.confidence * 100);

  const save = () => {
    onSaveEdit({ rule: rule.trim() || candidate.rule, evidence_snippet: snippet });
    setEditing(false);
  };
  const cancel = () => {
    setRule(candidate.rule);
    setSnippet(candidate.evidence_snippet);
    setEditing(false);
  };

  return (
    <div style={s.card(candidate.accepted)}>
      <div style={s.body}>
        <div style={s.titleRow}>
          {editing ? (
            <Textarea value={rule} onChange={setRule} rows={2} />
          ) : (
            <h3 style={s.title}>{candidate.rule}</h3>
          )}
          {!editing && (
            <button
              style={s.editBtn}
              onClick={() => setEditing(true)}
              title={t("card.edit")}
              aria-label={t("card.edit")}
            >
              <Icon.Edit size={14} />
            </button>
          )}
        </div>

        {candidate.evidence_path && (
          <div style={s.evidencePath}>
            <Icon.FileText size={12} />
            <span className="mono">{candidate.evidence_path}</span>
          </div>
        )}

        {editing ? (
          <Textarea value={snippet} onChange={setSnippet} rows={4} mono />
        ) : (
          candidate.evidence_snippet && (
            <pre style={s.snippet}>
              <code>{candidate.evidence_snippet}</code>
            </pre>
          )
        )}

        <div style={s.metaRow}>
          <Badge color="var(--text-secondary)">{t("card.source." + (candidate.source ?? "llm"))}</Badge>
          {candidate.category && <Badge color="var(--accent)">{candidate.category}</Badge>}
          {candidate.occurrences != null && candidate.occurrences > 0 && (
            <span style={s.occ}>{t("card.occurrences", { count: candidate.occurrences })}</span>
          )}
        </div>

        <div style={s.confRow}>
          <span style={s.confLabel}>{t("card.confidence")}</span>
          <div style={s.confBar}>
            <ProgressBar value={pct} color={confidenceColor(candidate.confidence)} />
          </div>
          <span className="mono tnum" style={s.confPct}>
            {pct}%
          </span>
        </div>
      </div>

      <div style={s.actions}>
        {editing ? (
          <>
            <Button kind="primary" size="sm" icon="Check" onClick={save}>
              {t("card.save")}
            </Button>
            <Button kind="ghost" size="sm" onClick={cancel}>
              {t("card.cancel")}
            </Button>
          </>
        ) : (
          <>
            <Button
              kind={candidate.accepted ? "primary" : "ghost"}
              size="sm"
              icon="Check"
              onClick={onAccept}
              disabled={busy}
            >
              {candidate.accepted ? t("card.accepted") : t("card.accept")}
            </Button>
            <Button kind="ghost" size="sm" icon="X" onClick={onReject} disabled={busy}>
              {t("card.reject")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
