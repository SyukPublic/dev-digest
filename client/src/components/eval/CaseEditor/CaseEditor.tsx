/* CaseEditor — author/edit an eval case (Mockup 6). Name (required); Input tabs
   Diff | Files | PR meta. The Diff tab switches Preview | Edit via a Segmented
   control (default Preview; parsePatch, added lines highlighted) WHEN no files
   exist; once ≥1 file is present the Diff tab renders the READ-ONLY synthesized
   diff (parsePatch(synthesizeAddedFilesDiff(files))) and the Edit toggle is
   hidden (files win over a pasted diff). The Files tab authors add-only
   { path, content } files (list + per-file content editor + add/remove + empty
   state); the active tab defaults to Files when the case already has files, else
   Diff. Expected-output JSON editor with a valid/invalid indicator (icon + TEXT)
   in its header row + "+ Finding skeleton"; "Run on save" toggle; "Run case"; a
   last-run banner. Fixed Modal width+height so switching tabs never resizes the
   dialog. Save is blocked on invalid JSON/envelope (AC-31) and on an invalid
   file set (empty/duplicate path, client guard; server 422 is authoritative).
   Focus trap comes from Modal. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Button, TextInput, Textarea, SelectInput, FormField, Tabs, Toggle, Icon, Segmented } from "@devdigest/ui";
import type { Agent, EvalCaseInput, EvalCase, EvalCaseDraft, EvalCaseListItem, EvalCaseFile } from "@devdigest/shared";
import { parsePatch, type Line } from "@/components/diff-viewer/helpers";
import { useToast } from "@/lib/toast";
import { useEvalCase, useCreateEvalCase, useUpdateEvalCase, useRunCase } from "@/lib/hooks/eval";
import { validateEnvelope, defaultEnvelopeText, FINDING_SKELETON, fmtPct, synthesizeAddedFilesDiff, validateFiles, type EvalFile } from "../helpers";

type LastRun = NonNullable<EvalCaseListItem["latest"]>;

/** The subset of a case the form prefills from — satisfied by a full `EvalCase`
 *  (edit) OR a finding-derived `EvalCaseDraft` (create prefilled). `input_files`
 *  is optional so an `EvalCaseDraft` (which has none) still satisfies it. */
type CaseEditorInitial = Pick<EvalCase, "name" | "input_diff" | "input_meta" | "expected_output"> & {
  input_files?: EvalCaseFile[] | null;
};

/** The owner a case is authored onto — an agent OR a skill (owner-generic). */
export type CaseEditorOwner = { kind: "agent" | "skill"; id: string; name: string };

/**
 * Resolve the effective owner. The two shipped agent call sites (AgentEditor
 * EvalsTab, PR "Turn into eval case") pass the legacy `agent` prop; the skill
 * pipeline passes `owner`. Exactly one must be supplied.
 */
function resolveOwner(agent: Pick<Agent, "id" | "name"> | undefined, owner: CaseEditorOwner | undefined): CaseEditorOwner {
  if (owner) return owner;
  if (agent) return { kind: "agent", id: agent.id, name: agent.name };
  throw new Error("CaseEditor requires either `owner` or the legacy `agent` prop");
}

export function CaseEditor({
  agent,
  owner,
  caseId,
  initialDraft,
  lastRun,
  onSaved,
  onClose,
}: {
  /** Legacy agent owner — kept working for the two shipped agent call sites. */
  agent?: Pick<Agent, "id" | "name">;
  /** Owner-generic prop (agent OR skill). Takes precedence over `agent`. */
  owner?: CaseEditorOwner;
  /** undefined = create a new case; a string = edit an existing one. */
  caseId?: string;
  /** Create-mode prefill (e.g. from a PR finding). Ignored when `caseId` is set. */
  initialDraft?: EvalCaseDraft;
  lastRun?: LastRun | null;
  /** Called with the persisted case after a successful Save (before `onClose`). */
  onSaved?: (saved: EvalCase) => void;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const resolvedOwner = resolveOwner(agent, owner);
  const { data, isLoading } = useEvalCase(caseId);
  if (caseId && (isLoading || !data)) {
    return <Modal title={t("caseEditor.newCase")} onClose={onClose}>{t("dashboard.loading")}</Modal>;
  }
  return (
    <CaseEditorForm
      owner={resolvedOwner}
      initial={data ?? initialDraft ?? null}
      caseId={caseId}
      lastRun={lastRun ?? null}
      onSaved={onSaved}
      onClose={onClose}
    />
  );
}

function CaseEditorForm({
  owner,
  initial,
  caseId,
  lastRun,
  onSaved,
  onClose,
}: {
  owner: CaseEditorOwner;
  initial: CaseEditorInitial | null;
  caseId?: string;
  lastRun: LastRun | null;
  onSaved?: (saved: EvalCase) => void;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const toast = useToast();
  const create = useCreateEvalCase(owner);
  const update = useUpdateEvalCase(owner);
  // Inline single-case run is only meaningful for agents (a skill run needs a
  // host agent, chosen in the Evals tab, not here). The hook is always called
  // (rules of hooks); the Run controls are gated to agent owners below.
  const run = useRunCase(owner.id);
  const isAgent = owner.kind === "agent";

  const meta0 = (initial?.input_meta ?? {}) as { title?: string; body?: string };
  const initialFiles: EvalFile[] = initial?.input_files ?? [];
  const [name, setName] = React.useState(initial?.name ?? "");
  // Default to Files when the case already has files, else Diff (AC-9).
  const [inputTab, setInputTab] = React.useState<"diff" | "files" | "prMeta">(
    initialFiles.length > 0 ? "files" : "diff",
  );
  const [diffMode, setDiffMode] = React.useState<"preview" | "edit">("preview");
  const [inputDiff, setInputDiff] = React.useState(initial?.input_diff ?? "");
  const [files, setFiles] = React.useState<EvalFile[]>(initialFiles);
  const [metaTitle, setMetaTitle] = React.useState(meta0.title ?? "");
  const [metaBody, setMetaBody] = React.useState(meta0.body ?? "");
  const [expectedText, setExpectedText] = React.useState(
    initial ? JSON.stringify(initial.expected_output, null, 2) : defaultEnvelopeText(),
  );
  const [runOnSave, setRunOnSave] = React.useState(false);
  const [lastResult, setLastResult] = React.useState<LastRun | null>(lastRun);

  const validation = validateEnvelope(expectedText);
  const expectation = validation.ok ? validation.value!.expectation : "must_find";
  // Files win over the pasted diff (AC-7/AC-8): when ≥1 file exists the Diff tab
  // previews the synthesized diff read-only; else the pasted diff exactly as today.
  const hasFiles = files.length > 0;
  const filesValidation = validateFiles(files);
  const filesError = filesValidation.ok
    ? null
    : filesValidation.error === "duplicatePath"
      ? t("caseEditor.files.duplicatePath", { path: filesValidation.duplicatePath! })
      : t("caseEditor.files.emptyPath");
  const saveDisabled =
    !name.trim() || !validation.ok || !filesValidation.ok || create.isPending || update.isPending;
  const effectiveDiff = hasFiles ? synthesizeAddedFilesDiff(files) : inputDiff;
  const lines = React.useMemo(() => parsePatch(effectiveDiff), [effectiveDiff]);

  function setExpectation(v: string) {
    if (validation.ok) {
      setExpectedText(JSON.stringify({ ...validation.value!, expectation: v }, null, 2));
    } else {
      setExpectedText(defaultEnvelopeText(v as "must_find" | "must_not_flag"));
    }
  }

  function insertSkeleton() {
    const base = validation.ok ? validation.value! : { expectation: "must_find" as const, findings: [] };
    setExpectedText(JSON.stringify({ ...base, findings: [...base.findings, FINDING_SKELETON] }, null, 2));
  }

  async function save() {
    if (saveDisabled) return;
    const input: EvalCaseInput = {
      owner_kind: owner.kind,
      owner_id: owner.id,
      name: name.trim(),
      input_diff: inputDiff,
      input_files: hasFiles ? files : null,
      input_meta: { title: metaTitle, body: metaBody },
      expected_output: validation.value!,
    };
    try {
      const saved = caseId
        ? await update.mutateAsync({ id: caseId, input })
        : await create.mutateAsync(input);
      if (runOnSave && isAgent) await run.mutateAsync(saved.id);
      onSaved?.(saved);
      onClose();
    } catch {
      toast.error(t("caseEditor.lastRunFailed"));
    }
  }

  async function runNow() {
    if (!caseId) return;
    try {
      const res = await run.mutateAsync(caseId);
      const r = res.result;
      setLastResult({
        run_id: res.run_id,
        pass: r.traces_passed > 0,
        recall: r.recall,
        precision: r.precision,
        citation_accuracy: r.citation_accuracy,
        actual_count: null,
        duration_ms: r.duration_ms,
        cost_usd: r.cost_usd,
        ran_at: new Date().toISOString(),
        error: null,
      });
    } catch {
      toast.error(t("caseEditor.lastRunFailed"));
    }
  }

  const footer = (
    <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
      {isAgent && (
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)" }}>
          <Toggle on={runOnSave} onChange={setRunOnSave} size={16} />
          {t("caseEditor.runOnSave")}
        </label>
      )}
      <div style={{ flex: 1 }} aria-hidden />
      <Button kind="ghost" size="sm" onClick={onClose}>{t("caseEditor.cancel")}</Button>
      {caseId && isAgent && (
        <Button kind="secondary" size="sm" icon="Play" loading={run.isPending} onClick={runNow}>
          {run.isPending ? t("caseEditor.running") : t("caseEditor.runCase")}
        </Button>
      )}
      <Button kind="primary" size="sm" disabled={saveDisabled} onClick={save}>
        {create.isPending || update.isPending ? t("caseEditor.saving") : t("caseEditor.save")}
      </Button>
    </div>
  );

  return (
    <Modal
      width={1080}
      height={760}
      title={caseId ? t("caseEditor.caseTitle", { name: name || initial?.name || "" }) : t("caseEditor.newCase")}
      subtitle={t("caseEditor.subtitle", { agent: owner.name })}
      onClose={onClose}
      footer={footer}
    >
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 20 }}>
        {/* left: name + input */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <FormField label={t("caseEditor.nameLabel")} required>
            <TextInput value={name} onChange={setName} placeholder={t("caseEditor.namePlaceholder")} aria-label={t("caseEditor.nameLabel")} />
          </FormField>

          <div>
            <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>{t("caseEditor.inputLabel")}</div>
            <Tabs
              value={inputTab}
              onChange={(k) => setInputTab(k as "diff" | "files" | "prMeta")}
              tabs={[
                { key: "diff", label: t("caseEditor.tabs.diff") },
                { key: "files", label: t("caseEditor.tabs.files") },
                { key: "prMeta", label: t("caseEditor.tabs.prMeta") },
              ]}
            />
            {inputTab === "diff" ? (
              <div style={{ marginTop: 10 }}>
                {hasFiles ? (
                  // Files present → the diff is synthesized and read-only (AC-7);
                  // the Edit toggle is hidden and a note explains why.
                  <>
                    <div style={{ marginBottom: 8, fontSize: 12, color: "var(--text-muted)" }} role="note">
                      {t("caseEditor.files.readOnlyDiff")}
                    </div>
                    <DiffPreview lines={lines} />
                  </>
                ) : (
                  <>
                    <div style={{ marginBottom: 8, display: "flex", justifyContent: "flex-end" }}>
                      <Segmented
                        ariaLabel={t("caseEditor.diffModeLabel")}
                        value={diffMode}
                        onChange={(v) => setDiffMode(v as "preview" | "edit")}
                        options={[
                          { value: "preview", label: t("caseEditor.preview") },
                          { value: "edit", label: t("caseEditor.edit") },
                        ]}
                      />
                    </div>
                    {diffMode === "edit" ? (
                      <Textarea value={inputDiff} onChange={setInputDiff} rows={16} mono fontSize={12} placeholder={t("caseEditor.diffPlaceholder")} />
                    ) : (
                      <DiffPreview lines={lines} />
                    )}
                  </>
                )}
              </div>
            ) : inputTab === "files" ? (
              <div style={{ marginTop: 10 }}>
                <FilesTab files={files} onChange={setFiles} error={filesError} />
              </div>
            ) : (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 12 }}>
                <FormField label={t("caseEditor.titleLabel")}>
                  <TextInput value={metaTitle} onChange={setMetaTitle} fontSize={12} placeholder={t("caseEditor.titlePlaceholder")} />
                </FormField>
                <FormField label={t("caseEditor.bodyLabel")}>
                  <Textarea value={metaBody} onChange={setMetaBody} rows={12} fontSize={12} placeholder={t("caseEditor.bodyPlaceholder")} />
                </FormField>
              </div>
            )}
          </div>
        </div>

        {/* right: expected output */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <FormField label={t("caseEditor.expectationLabel")}>
            <SelectInput
              value={expectation}
              onChange={setExpectation}
              options={[
                { value: "must_find", label: t("caseEditor.expectations.must_find") },
                { value: "must_not_flag", label: t("caseEditor.expectations.must_not_flag") },
              ]}
            />
          </FormField>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>{t("caseEditor.expectedOutput")}</span>
            <div
              role="status"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: validation.ok ? "var(--ok)" : "var(--crit)" }}
            >
              {validation.ok ? <Icon.Check size={14} /> : <Icon.X size={14} />}
              {validation.ok ? t("caseEditor.validJson") : t("caseEditor.invalidJson")}
            </div>
            <div style={{ flex: 1 }} aria-hidden />
            <Button kind="ghost" size="sm" onClick={insertSkeleton}>{t("caseEditor.findingSkeleton")}</Button>
          </div>
          <Textarea value={expectedText} onChange={setExpectedText} rows={18} mono fontSize={12} placeholder={t("caseEditor.expectedOutput")} />

          {lastResult && <LastRunBanner run={lastResult} />}
        </div>
      </div>
    </Modal>
  );
}

/** Read-only unified-diff preview: each line is prefixed with `+`/`-`/` ` (AC-20:
 *  added lines are marked by a `+` prefix, not colour alone) and colour-hinted. */
function DiffPreview({ lines }: { lines: Line[] }) {
  const t = useTranslations("eval");
  return (
    <pre style={{ margin: 0, padding: 10, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 8, overflow: "auto", height: 320, fontSize: 12 }}>
      {lines.length === 0 && (
        <div style={{ color: "var(--text-muted)" }}>{t("caseEditor.previewEmpty")}</div>
      )}
      {lines.map((l, i) => (
        <div
          key={i}
          style={{
            background: l.kind === "add" ? "var(--ok-bg, rgba(34,197,94,0.12))" : l.kind === "del" ? "var(--crit-bg, rgba(239,68,68,0.10))" : "transparent",
            color: l.kind === "hunk" ? "var(--text-muted)" : "var(--text)",
            whiteSpace: "pre-wrap",
          }}
        >
          {l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}
          {l.text}
        </div>
      ))}
    </pre>
  );
}

/**
 * The Files input tab: a left file list (selectable rows + per-file remove), an
 * "Add file" control, and a right content editor (path + content) bound to the
 * selected file (AC-2). Files are add-only `{ path, content }` (AC-4). Selection
 * is a purely-local UI concern kept here; `files` itself is owned by the parent
 * (it drives the Save payload and the synthesized Diff preview). Adding a file
 * appends a blank entry, selects it, and focuses its path field (AC-3).
 */
function FilesTab({
  files,
  onChange,
  error,
}: {
  files: EvalFile[];
  onChange: (files: EvalFile[]) => void;
  error: string | null;
}) {
  const t = useTranslations("eval");
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const [focusNonce, setFocusNonce] = React.useState(0);
  const editorRef = React.useRef<HTMLDivElement>(null);
  const safeIdx = Math.min(selectedIdx, Math.max(0, files.length - 1));
  const selected = files[safeIdx];

  // Move focus to the selected file's path field after an "Add file" (AC-3).
  React.useEffect(() => {
    if (focusNonce === 0) return;
    editorRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [focusNonce]);

  function addFile() {
    onChange([...files, { path: "", content: "" }]);
    setSelectedIdx(files.length); // the new (last) entry
    setFocusNonce((n) => n + 1);
  }
  function removeFile(i: number) {
    onChange(files.filter((_, j) => j !== i));
    setSelectedIdx((cur) => (cur > i ? cur - 1 : cur));
  }
  function editSelected(patch: Partial<EvalFile>) {
    onChange(files.map((f, j) => (j === safeIdx ? { ...f, ...patch } : f)));
  }

  const errorNote = error && (
    <div role="alert" style={{ marginTop: 10, fontSize: 12, color: "var(--crit)" }}>
      {error}
    </div>
  );

  if (files.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("caseEditor.files.empty")}</div>
        <Button kind="secondary" size="sm" icon="Plus" onClick={addFile}>
          {t("caseEditor.files.add")}
        </Button>
        {errorNote}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 38%) minmax(0, 1fr)", gap: 12 }}>
        {/* left: file list + add control */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <ul aria-label={t("caseEditor.files.listLabel")} style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            {/* Rows carry no local state (the editor lives in the right panel), so an
                index key is safe for this add-only, no-stable-id file list. */}
            {files.map((f, i) => {
              const on = i === safeIdx;
              return (
                <li key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <button
                    type="button"
                    aria-current={on ? "true" : undefined}
                    onClick={() => setSelectedIdx(i)}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      textAlign: "left",
                      padding: "7px 10px",
                      borderRadius: 6,
                      border: "1px solid " + (on ? "var(--accent)" : "var(--border)"),
                      background: on ? "var(--bg-hover)" : "transparent",
                      color: f.path ? "var(--text-primary)" : "var(--text-muted)",
                      fontSize: 12.5,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {f.path || t("caseEditor.files.pathPlaceholder")}
                  </button>
                  <Button kind="danger" size="sm" icon="Trash" aria-label={t("caseEditor.files.remove")} onClick={() => removeFile(i)} />
                </li>
              );
            })}
          </ul>
          <Button kind="secondary" size="sm" icon="Plus" onClick={addFile}>
            {t("caseEditor.files.add")}
          </Button>
        </div>

        {/* right: path + content editor for the selected file */}
        <div ref={editorRef} style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <FormField label={t("caseEditor.files.pathLabel")}>
            <TextInput
              value={selected?.path ?? ""}
              onChange={(v) => editSelected({ path: v })}
              fontSize={12}
              mono
              placeholder={t("caseEditor.files.pathPlaceholder")}
              aria-label={t("caseEditor.files.pathLabel")}
            />
          </FormField>
          <FormField label={t("caseEditor.files.contentLabel")}>
            <Textarea
              value={selected?.content ?? ""}
              onChange={(v) => editSelected({ content: v })}
              rows={12}
              mono
              fontSize={12}
              placeholder={t("caseEditor.files.contentPlaceholder")}
            />
          </FormField>
        </div>
      </div>
      {errorNote}
    </div>
  );
}

function LastRunBanner({ run }: { run: LastRun }) {
  const t = useTranslations("eval");
  const passed = run.pass === true;
  return (
    <div
      role="status"
      style={{
        marginTop: 4,
        padding: "8px 12px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: passed ? "var(--ok-bg, rgba(34,197,94,0.10))" : "var(--crit-bg, rgba(239,68,68,0.10))",
        fontSize: 13,
      }}
    >
      <span style={{ fontWeight: 600, color: passed ? "var(--ok)" : "var(--crit)" }}>
        {passed ? t("caseEditor.lastRunPassed") : t("caseEditor.lastRunFailed")}
      </span>{" "}
      <span style={{ color: "var(--text-muted)" }}>
        · recall {fmtPct(run.recall)} · precision {fmtPct(run.precision)} · citation {fmtPct(run.citation_accuracy)}
      </span>
    </div>
  );
}
