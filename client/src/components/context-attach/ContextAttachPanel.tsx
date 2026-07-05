/* ContextAttachPanel — the shared Project Context attach surface reused by the
   agent and skill Context tabs. Renders the discovered docs as attachable rows
   (ContextRow), keeps attached docs checked & ordered first, persists the full
   ordered path set on every toggle/reorder, shows per-doc + total attached
   tokens with a soft-budget warn indicator (attach never blocked), an aria-live
   token-total announcement, a "missing" badge for unresolved attached paths, an
   optional "SERIALIZES AS" path preview (skill tab), and the Preview drawer. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Skeleton } from "@devdigest/ui";
import type { DiscoveredDocument } from "@devdigest/shared";
import { useActiveRepo } from "@/lib/repo-context";
import {
  useProjectContextDocs,
  useProjectContextConfig,
  useAttachedSpecs,
  useSetAttachedSpecs,
  type SpecOwner,
} from "@/lib/hooks/project-context";
import { useContextAttach } from "./useContextAttach";
import { ContextRow } from "./ContextRow";
import { ContextPreviewDrawer } from "./ContextPreviewDrawer";
import { s } from "./styles";

/** Fallback SOFT total-token budget (AC-14) used only until the server value
    resolves. Matches the server default (`PROJECT_CONTEXT_TOKEN_BUDGET`) so the
    warn threshold is consistent; the resolved server value always wins. */
const DEFAULT_TOKEN_BUDGET = 20_000;

export function ContextAttachPanel({
  owner,
  ownerId,
  /** i18n keys (under the `context` namespace) for the section title/badge/helper. */
  titleKey,
  badgeKey,
  helperKey,
  /** Skill tab shows a "SERIALIZES AS" path preview under the list. */
  showSerialize = false,
  /** Message shown for the count badge: "M of N attached" (agent) uses total. */
  showTotalInBadge = false,
}: {
  owner: SpecOwner;
  ownerId: string;
  titleKey: string;
  badgeKey: string;
  helperKey: string;
  showSerialize?: boolean;
  showTotalInBadge?: boolean;
}) {
  const t = useTranslations("context");
  const { repoId } = useActiveRepo();
  // Owner-aware discovery: the server supplies any `missing: true` rows for this
  // owner's attached-but-absent paths (AC-15) — the panel no longer synthesizes them.
  const { data: docs, isLoading } = useProjectContextDocs(repoId, { owner, ownerId });
  const { data: contextConfig } = useProjectContextConfig(repoId);
  const { data: attached } = useAttachedSpecs(owner, ownerId);
  const setSpecs = useSetAttachedSpecs(owner);

  const persist = React.useCallback(
    (paths: string[]) => setSpecs.mutate({ id: ownerId, paths }),
    [setSpecs, ownerId],
  );

  const state = useContextAttach(docs, attached, persist);
  const [filter, setFilter] = React.useState("");
  const [preview, setPreview] = React.useState<DiscoveredDocument | null>(null);

  if (isLoading || !state.ready) return <Skeleton height={240} />;

  const q = filter.trim().toLowerCase();
  const visible = state.rows.filter((d) => !q || d.path.toLowerCase().includes(q));

  const byPath = new Map((docs ?? []).map((d) => [d.path, d]));
  const totalTokens = state.attachedPaths.reduce((sum, p) => sum + (byPath.get(p)?.tokens ?? 0), 0);
  const tokenBudget = contextConfig?.token_budget ?? DEFAULT_TOKEN_BUDGET;
  const overBudget = totalTokens > tokenBudget;

  const attachedCount = state.attachedPaths.length;
  const total = state.rows.length;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t(titleKey)}</h2>
        <Badge color="var(--accent)">
          {showTotalInBadge
            ? t(badgeKey, { attached: attachedCount, total })
            : t(badgeKey, { attached: attachedCount })}
        </Badge>
        <div style={s.search}>
          <Icon.Search size={13} style={{ color: "var(--text-muted)" }} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("filterPlaceholder")}
            style={s.searchInput}
          />
        </div>
      </div>
      <p style={s.hint}>{t(helperKey)}</p>

      {total === 0 ? (
        // Empty (non-error) list when no docs are discovered (AC-16).
        <p style={s.tokenNote}>{t("emptyList")}</p>
      ) : (
        <div>
          {visible.map((doc) => {
            const idx = state.rows.indexOf(doc);
            return (
              <ContextRow
                key={doc.path}
                doc={doc}
                attached={state.isAttached(doc.path)}
                dragging={state.dragPath === doc.path}
                canMoveUp={idx > 0}
                canMoveDown={idx < state.rows.length - 1}
                onToggle={() => state.toggle(doc.path)}
                onPreview={() => setPreview(doc)}
                onMove={(dir) => state.move(doc.path, dir)}
                onDragStart={() => state.setDragPath(doc.path)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => state.dragPath && state.moveBefore(state.dragPath, doc.path)}
              />
            );
          })}
        </div>
      )}

      {showSerialize && attachedCount > 0 && (
        <>
          <div style={s.serializeHead}>{t("serializeHead")}</div>
          <pre className="mono" style={s.serializeBlock}>
            {`## Project context\n${state.attachedPaths.map((p) => `- ${p}`).join("\n")}`}
          </pre>
        </>
      )}

      <div style={s.footer}>
        {/* aria-live so the running total is announced as docs are toggled (AC-19). */}
        <span style={s.tokenTotal} aria-live="polite">
          {t("tokenTotal", { count: totalTokens })}
        </span>
        {overBudget && (
          <Badge color="var(--warn)" icon="AlertTriangle">
            {t("overBudget")}
          </Badge>
        )}
        <div style={{ flex: 1 }} />
        <span style={s.tokenNote}>{t("injectedNote")}</span>
      </div>

      {preview && (
        <ContextPreviewDrawer
          repoId={repoId}
          doc={preview}
          attached={state.isAttached(preview.path)}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
