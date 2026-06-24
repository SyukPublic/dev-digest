/* CreateSkillFromConventionsModal — turn the accepted conventions into skills
   (source: extracted). Two modes: ONE merged `repo-conventions` skill, or ONE
   skill per category. An optional agent select links each new skill on save. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, FormField, Modal, SelectInput, Tabs, TextInput, Textarea, Toggle } from "@devdigest/ui";
import type { ConventionCandidate, SkillType } from "@devdigest/shared";
import { useCreateSkill } from "@/lib/hooks/skills";
import { useAgents } from "@/lib/hooks/agents";
import { useLinkAgentSkill } from "@/lib/hooks/conventions";
import { useToast } from "@/lib/toast";
import { buildSkillBody, defaultSkillName, planSkillsFromConventions } from "./helpers";

type Mode = "single" | "per-category";

/** Skill types — convention first (the default for an extracted-conventions skill). */
const SKILL_TYPES: SkillType[] = ["convention", "rubric", "security", "custom"];

export function CreateSkillFromConventionsModal({
  repoName,
  candidates,
  onClose,
}: {
  repoName: string;
  candidates: ConventionCandidate[];
  onClose: () => void;
}) {
  const t = useTranslations("conventions");
  const router = useRouter();
  const toast = useToast();
  const create = useCreateSkill();
  const link = useLinkAgentSkill();
  const { data: agents } = useAgents();

  const initialName = defaultSkillName(repoName);
  const [name, setName] = React.useState(initialName);
  const [description, setDescription] = React.useState(
    t("modal.defaultDescription", { count: candidates.length, repo: repoName }),
  );
  const [type, setType] = React.useState<SkillType>("convention");
  const [enabled, setEnabled] = React.useState(true);
  const [agentId, setAgentId] = React.useState("");
  const [body, setBody] = React.useState(() => buildSkillBody(initialName, repoName, candidates));

  const [mode, setMode] = React.useState<Mode>("single");
  const plans = React.useMemo(
    () => planSkillsFromConventions(repoName, candidates),
    [repoName, candidates],
  );
  // Store only edited names; the default comes from the plan (don't mirror derived state).
  const [nameOverrides, setNameOverrides] = React.useState<Record<string, string>>({});
  const nameFor = (category: string, fallback: string) => nameOverrides[category] ?? fallback;

  const pending = create.isPending || link.isPending;
  const canSubmit = mode === "single" ? candidates.length > 0 : plans.length > 0;

  /** Link the new skill to the chosen agent; best-effort, never blocks the flow. */
  const linkBestEffort = async (skillId: string) => {
    if (!agentId) return;
    try {
      await link.mutateAsync({ agentId, skillId });
    } catch {
      /* linking is best-effort; the skill still lands in Skills Lab */
    }
  };

  const submitSingle = async () => {
    const skill = await create.mutateAsync({
      name: name.trim() || initialName,
      description,
      type,
      source: "extracted",
      body,
      enabled,
      evidence_files: [...new Set(candidates.map((c) => c.evidence_path).filter(Boolean))],
    });
    await linkBestEffort(skill.id);
    onClose();
    router.push(`/skills/${skill.id}?tab=config`);
  };

  const submitPerCategory = async () => {
    const created: { id: string }[] = [];
    const failed: string[] = [];
    // Sequential & best-effort (variant A): a failed create leaves earlier ones created.
    for (const plan of plans) {
      try {
        const skill = await create.mutateAsync({
          name: nameFor(plan.category, plan.name).trim() || plan.name,
          description: t("modal.perCategory.description", {
            count: plan.count,
            category: plan.category,
            repo: repoName,
          }),
          type,
          source: "extracted",
          body: plan.body,
          enabled,
          evidence_files: plan.evidenceFiles,
        });
        created.push(skill);
        await linkBestEffort(skill.id);
      } catch {
        failed.push(plan.category);
      }
    }
    if (created.length) {
      toast.success(t("modal.result.created", { created: created.length, total: plans.length }));
    }
    if (failed.length) {
      toast.error(t("modal.result.failed", { categories: failed.join(", ") }));
    }
    onClose();
    // Navigate only when exactly one skill resulted — else we'd "swallow" the rest.
    if (created.length === 1) router.push(`/skills/${created[0]!.id}?tab=config`);
  };

  const submit = mode === "single" ? submitSingle : submitPerCategory;

  return (
    <Modal
      width={680}
      title={t("modal.title")}
      subtitle={mode === "single" ? name : t("modal.perCategory.preview", { count: plans.length })}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button kind="ghost" onClick={onClose}>
            {t("modal.cancel")}
          </Button>
          <Button
            kind="primary"
            icon="Sparkles"
            onClick={submit}
            disabled={pending || !canSubmit}
          >
            {pending ? t("modal.creating") : t("modal.create")}
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Tabs
          tabs={[
            { key: "single", label: t("modal.mode.single") },
            { key: "per-category", label: t("modal.mode.perCategory") },
          ]}
          value={mode}
          onChange={(k) => setMode(k as Mode)}
          pad="0"
        />

        {mode === "single" ? (
          <>
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              {t("modal.mergedFrom", { count: candidates.length, repo: repoName })}
            </div>
            <FormField label={t("modal.fields.name")} required>
              <TextInput value={name} onChange={setName} mono />
            </FormField>
            <FormField label={t("modal.fields.description")}>
              <TextInput value={description} onChange={setDescription} />
            </FormField>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              {t("modal.perCategory.preview", { count: plans.length })}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {plans.map((plan) => (
                <div key={plan.category} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <code style={{ fontSize: 13, color: "var(--text-primary)", minWidth: 110 }}>
                    {plan.category}
                  </code>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                    {t("modal.perCategory.item", { count: plan.count })}
                  </span>
                  <div style={{ flex: 1 }}>
                    <TextInput
                      value={nameFor(plan.category, plan.name)}
                      onChange={(v) => setNameOverrides((m) => ({ ...m, [plan.category]: v }))}
                      mono
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <FormField label={t("modal.fields.type")}>
            <SelectInput
              value={type}
              onChange={(v) => setType(v as SkillType)}
              options={SKILL_TYPES.map((v) => ({ value: v, label: v }))}
            />
          </FormField>
          <FormField label={t("modal.fields.agent")}>
            <SelectInput
              value={agentId}
              onChange={setAgentId}
              options={[
                { value: "", label: t("modal.fields.agentNone") },
                ...(agents ?? []).map((a) => ({ value: a.id, label: a.name })),
              ]}
            />
          </FormField>
        </div>
        <FormField label={t("modal.fields.enabled")} hint={t("modal.fields.enabledHint")}>
          <Toggle on={enabled} onChange={setEnabled} />
        </FormField>
        {mode === "single" && (
          <FormField label={t("modal.fields.body")} required>
            <Textarea value={body} onChange={setBody} rows={12} mono />
          </FormField>
        )}
      </div>
    </Modal>
  );
}
