/* MemoryForm — create/edit a memory entry in a modal. Client-side validation
   mirrors the server DTO (content required, confidence 0..1, repo required for
   repo scope — AC-7); on save the parent runs the create/update mutation and the
   list reflects the change without a full reload (AC-21). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Modal, SelectInput, TextInput, Textarea } from "@devdigest/ui";
import type { CreateMemory, Memory, MemoryKind, MemoryScope, MemorySource } from "@devdigest/shared";
import { s } from "./styles";

const SCOPES: MemoryScope[] = ["repo", "global", "team"];
const KINDS: MemoryKind[] = ["decision", "convention", "preference", "fact", "learning"];

interface SourceDraft {
  pr: string;
  context: string;
}

export function MemoryForm({
  mode,
  initial,
  repoId,
  repoName,
  busy,
  onSave,
  onClose,
}: {
  mode: "create" | "edit";
  initial?: Memory;
  repoId: string | null;
  repoName: string | null;
  busy?: boolean;
  onSave: (payload: CreateMemory) => void;
  onClose: () => void;
}) {
  const t = useTranslations("memory");
  const [content, setContent] = React.useState(initial?.content ?? "");
  const [scope, setScope] = React.useState<MemoryScope>(initial?.scope ?? "global");
  const [kind, setKind] = React.useState<MemoryKind>(initial?.kind ?? "decision");
  const [confidencePct, setConfidencePct] = React.useState(
    String(Math.round((initial?.confidence ?? 0.8) * 100)),
  );
  const [sources, setSources] = React.useState<SourceDraft[]>(
    (initial?.sources ?? []).map((src) => ({ pr: src.pr != null ? String(src.pr) : "", context: src.context })),
  );
  const [errors, setErrors] = React.useState<{ content?: string; confidence?: string; repo?: string }>({});

  const setSource = (i: number, patch: Partial<SourceDraft>) =>
    setSources((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const validate = (): CreateMemory | null => {
    const next: typeof errors = {};
    const pct = Number(confidencePct);
    if (!content.trim()) next.content = t("form.errors.content");
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) next.confidence = t("form.errors.confidence");
    if (scope === "repo" && !repoId) next.repo = t("form.errors.repo");
    setErrors(next);
    if (Object.keys(next).length > 0) return null;

    const cleanSources: MemorySource[] = sources
      .filter((row) => row.context.trim())
      .map((row) => {
        const pr = Number(row.pr);
        return row.pr.trim() && Number.isFinite(pr)
          ? { pr, context: row.context.trim() }
          : { context: row.context.trim() };
      });

    return {
      content: content.trim(),
      scope,
      kind,
      confidence: pct / 100,
      sources: cleanSources,
      repo_id: scope === "repo" ? repoId : null,
    };
  };

  const submit = () => {
    const payload = validate();
    if (payload) onSave(payload);
  };

  return (
    <Modal
      title={mode === "create" ? t("form.createTitle") : t("form.editTitle")}
      onClose={onClose}
      footer={
        <>
          <Button kind="ghost" size="sm" onClick={onClose}>
            {t("form.cancel")}
          </Button>
          <Button kind="primary" size="sm" icon="Check" onClick={submit} disabled={busy}>
            {t("form.save")}
          </Button>
        </>
      }
    >
      <FormField label={t("form.content")} required>
        <Textarea value={content} onChange={setContent} rows={4} />
      </FormField>
      {errors.content && <div style={s.formError}>{errors.content}</div>}

      <div style={s.formRow}>
        <div style={{ flex: 1 }}>
          <FormField label={t("form.scope")} required>
            <SelectInput
              value={scope}
              onChange={(v) => setScope(v as MemoryScope)}
              options={SCOPES.map((sc) => ({ value: sc, label: t(`scope.${sc}`) }))}
            />
          </FormField>
        </div>
        <div style={{ flex: 1 }}>
          <FormField label={t("form.kind")} required>
            <SelectInput
              value={kind}
              onChange={(v) => setKind(v as MemoryKind)}
              options={KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) }))}
            />
          </FormField>
        </div>
      </div>

      <div style={s.formRow}>
        <div style={{ flex: 1 }}>
          <FormField label={t("form.confidence")} required>
            <TextInput value={confidencePct} onChange={setConfidencePct} type="number" suffix="%" />
          </FormField>
          {errors.confidence && <div style={s.formError}>{errors.confidence}</div>}
        </div>
        {scope === "repo" && (
          <div style={{ flex: 1 }}>
            <FormField label={t("form.repo")} required hint={t("form.repoHint")}>
              <TextInput value={repoName ?? t("form.repoNone")} onChange={() => {}} />
            </FormField>
            {errors.repo && <div style={s.formError}>{errors.repo}</div>}
          </div>
        )}
      </div>

      <FormField
        label={t("form.sources")}
        right={
          <Button
            kind="ghost"
            size="sm"
            icon="Plus"
            onClick={() => setSources((prev) => [...prev, { pr: "", context: "" }])}
          >
            {t("form.addSource")}
          </Button>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sources.map((row, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ width: 90 }}>
                <TextInput
                  value={row.pr}
                  onChange={(v) => setSource(i, { pr: v })}
                  placeholder={t("form.sourcePr")}
                  type="number"
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextInput
                  value={row.context}
                  onChange={(v) => setSource(i, { context: v })}
                  placeholder={t("form.sourceContext")}
                />
              </div>
              <Button
                kind="ghost"
                size="sm"
                icon="X"
                onClick={() => setSources((prev) => prev.filter((_, idx) => idx !== i))}
              >
                <span style={s.srOnly}>{t("form.removeSource")}</span>
              </Button>
            </div>
          ))}
        </div>
      </FormField>
    </Modal>
  );
}
