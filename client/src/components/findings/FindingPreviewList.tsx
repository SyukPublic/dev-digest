/* FindingPreviewList — compact, read-only list of findings shared by the
   findings popovers (PR-list FINDINGS cell + PR-detail timeline run rows).
   Presentational: the parent owns data + an optional per-finding click. */
"use client";

import React from "react";
import { Icon, SeverityBadge, CategoryTag, ConfidenceNum } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { s } from "./styles";

function FindingRow({ f }: { f: FindingRecord }) {
  return (
    <>
      <div style={s.itemHead}>
        <SeverityBadge severity={f.severity} compact />
        <span style={s.itemTitle}>{f.title}</span>
        <CategoryTag category={f.category} />
      </div>
      <div style={s.itemMeta}>
        <span className="mono" style={s.fileRef}>
          <Icon.FileText size={12} />
          {f.file}:{f.start_line}
        </span>
        <ConfidenceNum value={f.confidence} />
      </div>
      <span style={s.rationale}>{f.rationale}</span>
    </>
  );
}

export function FindingPreviewList({
  findings,
  onPick,
}: {
  findings: FindingRecord[];
  /** Optional click handler per finding (e.g. drill into the PR / run). */
  onPick?: (finding: FindingRecord) => void;
}) {
  return (
    <div style={s.list}>
      {findings.map((f) =>
        onPick ? (
          <button key={f.id} type="button" style={s.item(true)} onClick={() => onPick(f)}>
            <FindingRow f={f} />
          </button>
        ) : (
          <div key={f.id} style={s.item(false)}>
            <FindingRow f={f} />
          </div>
        ),
      )}
    </div>
  );
}
