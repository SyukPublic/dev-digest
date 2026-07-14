"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, ExportWizardSteps, Button } from "@devdigest/ui";
import type { CiFile, CiTarget } from "@devdigest/shared";
import { useExportCi } from "@/lib/hooks/ci";
import { useToast } from "@/lib/toast";
import {
  DEFAULT_TRIGGERS,
  TRIGGER_EVENTS,
  WIZARD_STEP_KEYS,
  type PostAsValue,
  type TriggerEvent,
} from "../../constants";
import { s } from "../../styles";
import { TargetStep } from "./steps/TargetStep";
import { PreviewStep } from "./steps/PreviewStep";
import { ConfigureStep } from "./steps/ConfigureStep";
import { InstallStep } from "./steps/InstallStep";

/**
 * Export-to-CI wizard — a 4-step modal (Target → Preview → Configure → Install).
 * Owns all wizard state; the steps are presentational. Preview files are fetched
 * with `action:'files'`, edits are carried into the `action:'open_pr'` install.
 */
export function ExportWizard({
  agentId,
  agentName,
  onClose,
}: {
  agentId: string;
  agentName: string;
  onClose: () => void;
}) {
  const t = useTranslations("ci");
  const toast = useToast();
  const exportCi = useExportCi(agentId);

  const [step, setStep] = React.useState(0);
  const [repo, setRepo] = React.useState("");
  const [target, setTarget] = React.useState<CiTarget>("gha");
  const [files, setFiles] = React.useState<CiFile[]>([]);
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [edits, setEdits] = React.useState<Record<string, string>>({});
  const [triggers, setTriggers] = React.useState<Record<TriggerEvent, boolean>>(DEFAULT_TRIGGERS);
  const [postAs, setPostAs] = React.useState<PostAsValue>("github_review");
  const [prUrl, setPrUrl] = React.useState<string | null>(null);

  const generating = exportCi.isPending && step === 1;
  const installing = exportCi.isPending && step === 3;

  const selectedTriggers = TRIGGER_EVENTS.filter((ev) => triggers[ev]);
  const mergedFiles = files.map((f) => ({ ...f, contents: edits[f.path] ?? f.contents }));

  const labels = WIZARD_STEP_KEYS.map((k) => t(`exportWizard.steps.${k}`));

  const startPreview = () => {
    setStep(1);
    exportCi.mutate(
      { repo, target, action: "files", post_as: postAs, triggers: selectedTriggers, base: "main" },
      {
        onSuccess: (data) => {
          setFiles(data.files);
          setSelectedPath((prev) => prev ?? data.files[0]?.path ?? null);
        },
      },
    );
  };

  const install = () => {
    exportCi.mutate(
      { repo, target, action: "open_pr", post_as: postAs, triggers: selectedTriggers, base: "main", files: mergedFiles },
      {
        onSuccess: (data) => {
          setPrUrl(data.pr_url);
          toast.success(`${t("publishDialog.doneBody", { repo })}${data.pr_url ? ` — ${data.pr_url}` : ""}`);
        },
      },
    );
  };

  const canContinue =
    step === 0
      ? target === "gha" && repo.trim() !== ""
      : step === 1
        ? !generating && files.length > 0
        : true;

  const onPrimary = () => {
    if (step === 0) startPreview();
    else if (step < 3) setStep(step + 1);
    else install();
  };

  const footer = (
    <div style={s.wizardFooter}>
      <ExportWizardSteps step={step} labels={labels} />
      <div style={s.footerBtns}>
        <Button kind="ghost" onClick={() => setStep((v) => Math.max(0, v - 1))} disabled={step === 0}>
          {t("exportWizard.back")}
        </Button>
        <Button
          kind="primary"
          onClick={onPrimary}
          loading={installing}
          disabled={(step < 3 && !canContinue) || installing}
        >
          {step === 3 ? t("exportWizard.install") : t("exportWizard.continue")}
        </Button>
      </div>
    </div>
  );

  return (
    <Modal
      width={760}
      height={640}
      title={t("exportWizard.title")}
      subtitle={t("exportWizard.subtitle", { agentName: agentName || t("exportWizard.thisAgent") })}
      onClose={onClose}
      footer={footer}
    >
      {step === 0 && <TargetStep repo={repo} onRepo={setRepo} target={target} onTarget={setTarget} />}
      {step === 1 && (
        <PreviewStep
          files={files}
          generating={generating}
          selectedPath={selectedPath}
          onSelect={setSelectedPath}
          edits={edits}
          onEdit={(path, contents) => setEdits((prev) => ({ ...prev, [path]: contents }))}
        />
      )}
      {step === 2 && (
        <ConfigureStep
          triggers={triggers}
          onToggleTrigger={(ev) => setTriggers((prev) => ({ ...prev, [ev]: !prev[ev] }))}
          postAs={postAs}
          onPostAs={setPostAs}
        />
      )}
      {step === 3 && (
        <InstallStep repo={repo} fileCount={mergedFiles.length} installing={installing} prUrl={prUrl} />
      )}
    </Modal>
  );
}
