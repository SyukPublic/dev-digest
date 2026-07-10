/* CaseEditor — author/edit an eval case (Mockup 6). Name (required); Input tabs
   Diff | PR meta (NO Files tab); unified-diff preview (parsePatch, added lines
   highlighted); Expected-output JSON editor with a valid/invalid indicator
   (icon + TEXT) + "+ Finding skeleton"; "Run on save" toggle; "Run case"; a
   last-run banner. Save is blocked on invalid JSON/envelope (AC-31, client
   guard; server 422 is authoritative). Focus trap comes from Modal. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Button, TextInput, Textarea, SelectInput, FormField, Tabs, Toggle, Icon } from "@devdigest/ui";
import type { Agent, EvalCaseInput, EvalCase, EvalCaseListItem } from "@devdigest/shared";
import { parsePatch } from "@/components/diff-viewer/helpers";
import { useToast } from "@/lib/toast";
import { useEvalCase, useCreateEvalCase, useUpdateEvalCase, useRunCase } from "@/lib/hooks/eval";
import { validateEnvelope, defaultEnvelopeText, FINDING_SKELETON, fmtPct } from "../helpers";

type LastRun = NonNullable<EvalCaseListItem["latest"]>;

export function CaseEditor({
  agent,
  caseId,
  lastRun,
  onClose,
}: {
  agent: Pick<Agent, "id" | "name">;
  /** undefined = create a new case; a string = edit an existing one. */
  caseId?: string;
  lastRun?: LastRun | null;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const { data, isLoading } = useEvalCase(caseId);
  if (caseId && (isLoading || !data)) {
    return <Modal title={t("caseEditor.newCase")} onClose={onClose}>{t("dashboard.loading")}</Modal>;
  }
  return (
    <CaseEditorForm agent={agent} initial={data ?? null} caseId={caseId} lastRun={lastRun ?? null} onClose={onClose} />
  );
}

function CaseEditorForm({
  agent,
  initial,
  caseId,
  lastRun,
  onClose,
}: {
  agent: Pick<Agent, "id" | "name">;
  initial: EvalCase | null;
  caseId?: string;
  lastRun: LastRun | null;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const toast = useToast();
  const create = useCreateEvalCase(agent.id);
  const update = useUpdateEvalCase(agent.id);
  const run = useRunCase(agent.id);

  const meta0 = (initial?.input_meta ?? {}) as { title?: string; body?: string };
  const [name, setName] = React.useState(initial?.name ?? "");
  const [inputTab, setInputTab] = React.useState<"diff" | "prMeta">("diff");
  const [inputDiff, setInputDiff] = React.useState(initial?.input_diff ?? "");
  const [metaTitle, setMetaTitle] = React.useState(meta0.title ?? "");
  const [metaBody, setMetaBody] = React.useState(meta0.body ?? "");
  const [expectedText, setExpectedText] = React.useState(
    initial ? JSON.stringify(initial.expected_output, null, 2) : defaultEnvelopeText(),
  );
  const [runOnSave, setRunOnSave] = React.useState(false);
  const [lastResult, setLastResult] = React.useState<LastRun | null>(lastRun);

  const validation = validateEnvelope(expectedText);
  const expectation = validation.ok ? validation.value!.expectation : "must_find";
  const saveDisabled = !name.trim() || !validation.ok || create.isPending || update.isPending;
  const lines = React.useMemo(() => parsePatch(inputDiff), [inputDiff]);

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
      owner_kind: "agent",
      owner_id: agent.id,
      name: name.trim(),
      input_diff: inputDiff,
      input_meta: { title: metaTitle, body: metaBody },
      expected_output: validation.value!,
    };
    try {
      const saved = caseId
        ? await update.mutateAsync({ id: caseId, input })
        : await create.mutateAsync(input);
      if (runOnSave) await run.mutateAsync(saved.id);
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
      <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)" }}>
        <Toggle on={runOnSave} onChange={setRunOnSave} size={16} />
        {t("caseEditor.runOnSave")}
      </label>
      <div style={{ flex: 1 }} aria-hidden />
      <Button kind="ghost" size="sm" onClick={onClose}>{t("caseEditor.cancel")}</Button>
      {caseId && (
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
      width={840}
      title={caseId ? t("caseEditor.caseTitle", { name: name || initial?.name || "" }) : t("caseEditor.newCase")}
      subtitle={t("caseEditor.subtitle", { agent: agent.name })}
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
              onChange={(k) => setInputTab(k as "diff" | "prMeta")}
              tabs={[
                { key: "diff", label: t("caseEditor.tabs.diff") },
                { key: "prMeta", label: t("caseEditor.tabs.prMeta") },
              ]}
            />
            {inputTab === "diff" ? (
              <div style={{ marginTop: 10 }}>
                <Textarea value={inputDiff} onChange={setInputDiff} rows={8} mono placeholder={t("caseEditor.diffPlaceholder")} />
                <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-muted)" }}>{t("caseEditor.preview")}</div>
                <pre style={{ margin: "6px 0 0", padding: 10, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 8, overflow: "auto", maxHeight: 180, fontSize: 12 }}>
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
              </div>
            ) : (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 12 }}>
                <FormField label={t("caseEditor.titleLabel")}>
                  <TextInput value={metaTitle} onChange={setMetaTitle} placeholder={t("caseEditor.titlePlaceholder")} />
                </FormField>
                <FormField label={t("caseEditor.bodyLabel")}>
                  <Textarea value={metaBody} onChange={setMetaBody} rows={4} placeholder={t("caseEditor.bodyPlaceholder")} />
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

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>{t("caseEditor.expectedOutput")}</span>
            <Button kind="ghost" size="sm" onClick={insertSkeleton}>{t("caseEditor.findingSkeleton")}</Button>
          </div>
          <Textarea value={expectedText} onChange={setExpectedText} rows={12} mono placeholder={t("caseEditor.expectedOutput")} />
          <div
            role="status"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: validation.ok ? "var(--ok)" : "var(--crit)" }}
          >
            {validation.ok ? <Icon.Check size={14} /> : <Icon.X size={14} />}
            {validation.ok ? t("caseEditor.validJson") : t("caseEditor.invalidJson")}
          </div>

          {lastResult && <LastRunBanner run={lastResult} />}
        </div>
      </div>
    </Modal>
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
