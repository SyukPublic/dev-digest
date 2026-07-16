/* /memory — Review Memory studio. Three-pane view (filter rail / list / detail)
   matching the approved mockup: header with count + pgvector + curated-nightly
   labels and a semantic search box, a scope/kind/freshness rail, entry cards,
   and a detail panel with edit/delete + create/edit form + delete confirm.
   All content is rendered as escaped text (AC-24); all strings via next-intl. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Icon, Skeleton, TextInput } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useActiveRepo } from "@/lib/repo-context";
import type { CreateMemory, Memory, MemoryFacets, MemoryKind, MemoryScope } from "@devdigest/shared";
import {
  useMemory,
  useMemorySearch,
  useCreateMemory,
  useUpdateMemory,
  useDeleteMemory,
} from "@/lib/hooks/memory";
import { FilterRail } from "./FilterRail";
import { MemoryCard } from "./MemoryCard";
import { MemoryDetail } from "./MemoryDetail";
import { MemoryForm } from "./MemoryForm";
import { ConfirmDelete } from "./ConfirmDelete";
import { s } from "./styles";

const EMPTY_FACETS: MemoryFacets = { scope: {}, kind: {} };

export function MemoryView() {
  const t = useTranslations("memory");
  const { repoId, activeRepo } = useActiveRepo();

  const [scope, setScope] = React.useState<MemoryScope[]>([]);
  const [kind, setKind] = React.useState<MemoryKind[]>([]);
  const [stale, setStale] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<{ mode: "create" | "edit"; initial?: Memory } | null>(null);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);

  const filters = { repoId, scope, kind, stale };
  const base = useMemory(filters);
  const searching = q.trim().length > 0;
  const search = useMemorySearch(q, repoId);

  const create = useCreateMemory();
  const update = useUpdateMemory();
  const del = useDeleteMemory();

  const facets = base.data?.facets ?? EMPTY_FACETS;
  const total = base.data?.total ?? 0;

  const showSearchError = searching && search.isError;
  const items = searching && !showSearchError ? (search.data?.items ?? []) : (base.data?.items ?? []);
  const loading = searching && !showSearchError ? search.isLoading : base.isLoading;

  // Selected entry can come from either query's items (so the detail persists
  // across a search) — look it up in a merged map.
  const byId = new Map<string, Memory>();
  for (const it of base.data?.items ?? []) byId.set(it.id, it);
  for (const it of search.data?.items ?? []) byId.set(it.id, it);
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;

  const toggle = <T,>(setFn: React.Dispatch<React.SetStateAction<T[]>>, v: T) =>
    setFn((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));

  const openCreate = () => setForm({ mode: "create" });
  const openEdit = () => selected && setForm({ mode: "edit", initial: selected });

  const onSave = (payload: CreateMemory) => {
    if (form?.mode === "edit" && form.initial) {
      update.mutate({ id: form.initial.id, patch: payload }, { onSuccess: () => setForm(null) });
    } else {
      create.mutate(payload, { onSuccess: () => setForm(null) });
    }
  };

  const onConfirmDelete = () => {
    if (!deleteId) return;
    del.mutate(deleteId, {
      onSuccess: () => {
        if (selectedId === deleteId) setSelectedId(null);
        setDeleteId(null);
      },
    });
  };

  return (
    <AppShell crumb={[{ label: t("page.crumb") }]}>
      {form && (
        <MemoryForm
          mode={form.mode}
          initial={form.initial}
          repoId={repoId}
          repoName={activeRepo?.name ?? null}
          busy={create.isPending || update.isPending}
          onSave={onSave}
          onClose={() => setForm(null)}
        />
      )}
      {deleteId && (
        <ConfirmDelete busy={del.isPending} onConfirm={onConfirmDelete} onCancel={() => setDeleteId(null)} />
      )}

      <div style={s.page}>
        <div style={s.headerRow}>
          <h1 style={s.h1}>{t("page.heading")}</h1>
          <span style={s.subtitle}>{t("page.count", { count: total })}</span>
          <div style={{ flex: 1 }} />
          <Button kind="primary" size="sm" icon="Plus" onClick={openCreate}>
            {t("page.newEntry")}
          </Button>
        </div>

        <div style={s.searchRow}>
          <div style={s.searchGrow}>
            <TextInput
              value={q}
              onChange={setQ}
              placeholder={t("page.searchPlaceholder")}
              aria-label={t("page.searchLabel")}
              suffix={<Badge icon="Search" color="var(--text-muted)">{t("page.searchSemantic")}</Badge>}
            />
          </div>
        </div>

        {/* aria-live announcement of async list/detail/search updates (AC-25). */}
        <div aria-live="polite" style={s.srOnly}>
          {loading ? t("page.loading") : t("page.announce", { count: items.length })}
        </div>

        {base.isError ? (
          <ErrorState body={t("page.loadError")} onRetry={() => base.refetch()} />
        ) : (
          <div style={s.panes}>
            <FilterRail
              facets={facets}
              scope={scope}
              kind={kind}
              stale={stale}
              onToggleScope={(v) => toggle(setScope, v)}
              onToggleKind={(v) => toggle(setKind, v)}
              onToggleStale={setStale}
            />

            <div>
              {showSearchError && (
                <div style={s.banner} role="alert">
                  <Icon.AlertTriangle size={15} />
                  {t("page.searchError")}
                </div>
              )}

              {loading ? (
                <div style={s.list}>
                  <Skeleton height={92} />
                  <Skeleton height={92} />
                  <Skeleton height={92} />
                </div>
              ) : items.length === 0 ? (
                !searching && total === 0 ? (
                  <EmptyState
                    icon="Brain"
                    title={t("page.empty.title")}
                    body={t("page.empty.body")}
                    cta={t("page.empty.cta")}
                    onCta={openCreate}
                  />
                ) : (
                  <EmptyState icon="Search" title={t("page.noResults.title")} body={t("page.noResults.body")} />
                )
              ) : (
                <div style={s.list}>
                  {items.map((entry) => (
                    <MemoryCard
                      key={entry.id}
                      entry={entry}
                      selected={entry.id === selectedId}
                      onSelect={() => setSelectedId(entry.id)}
                    />
                  ))}
                </div>
              )}
            </div>

            <MemoryDetail entry={selected} onEdit={openEdit} onDelete={() => selected && setDeleteId(selected.id)} />
          </div>
        )}
      </div>
    </AppShell>
  );
}
