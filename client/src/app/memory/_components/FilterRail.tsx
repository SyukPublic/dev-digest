/* FilterRail — SCOPE + KIND facet toggles (checkbox rows with per-facet counts)
   and the "Show Stale (>60d)" freshness toggle. Pure/controlled: the parent owns
   the selection state and refetches via the query key. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Checkbox } from "@devdigest/ui";
import type { MemoryFacets, MemoryKind, MemoryScope } from "@devdigest/shared";
import { s } from "./styles";

const SCOPES: MemoryScope[] = ["repo", "global", "team"];
const KINDS: MemoryKind[] = ["decision", "convention", "preference", "fact", "learning"];

export function FilterRail({
  facets,
  scope,
  kind,
  stale,
  onToggleScope,
  onToggleKind,
  onToggleStale,
}: {
  facets: MemoryFacets;
  scope: MemoryScope[];
  kind: MemoryKind[];
  stale: boolean;
  onToggleScope: (v: MemoryScope) => void;
  onToggleKind: (v: MemoryKind) => void;
  onToggleStale: (v: boolean) => void;
}) {
  const t = useTranslations("memory");

  return (
    <nav style={s.rail} aria-label={t("page.filters.scope") + " / " + t("page.filters.kind")}>
      <div style={s.railSection}>
        <SectionTitle>{t("page.filters.scope")}</SectionTitle>
        {SCOPES.map((sc) => (
          <div key={sc} style={s.railRow}>
            <Checkbox
              checked={scope.includes(sc)}
              onChange={() => onToggleScope(sc)}
              label={t(`scope.${sc}`)}
            />
            <span style={s.railCount} className="tnum">
              {facets.scope[sc] ?? 0}
            </span>
          </div>
        ))}
      </div>

      <div style={s.railSection}>
        <SectionTitle>{t("page.filters.kind")}</SectionTitle>
        {KINDS.map((k) => (
          <div key={k} style={s.railRow}>
            <Checkbox
              checked={kind.includes(k)}
              onChange={() => onToggleKind(k)}
              label={t(`kind.${k}`)}
            />
            <span style={s.railCount} className="tnum">
              {facets.kind[k] ?? 0}
            </span>
          </div>
        ))}
      </div>

      <div style={s.railSection}>
        <SectionTitle>{t("page.filters.freshness")}</SectionTitle>
        <div style={s.railRow}>
          <Checkbox checked={stale} onChange={onToggleStale} label={t("page.filters.showStale")} />
        </div>
      </div>
    </nav>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--text-muted)",
        marginBottom: 2,
      }}
    >
      {children}
    </div>
  );
}
