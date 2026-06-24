/* CreateSkillFromConventionsModal — merge the accepted conventions into ONE
   `repo-conventions` skill (source: extracted). Name/description/type/body are
   editable; an optional agent select links the new skill on save. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, FormField, Modal, SelectInput, TextInput, Textarea, Toggle } from "@devdigest/ui";
import type { ConventionCandidate, SkillType } from "@devdigest/shared";
import { useCreateSkill } from "@/lib/hooks/skills";
import { useAgents } from "@/lib/hooks/agents";
import { useLinkAgentSkill } from "@/lib/hooks/conventions";
import { buildSkillBody, defaultSkillName } from "./helpers";

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

  const pending = create.isPending || link.isPending;

  const submit = async () => {
    const skill = await create.mutateAsync({
      name: name.trim() || initialName,
      description,
      type,
      source: "extracted",
      body,
      enabled,
      evidence_files: [...new Set(candidates.map((c) => c.evidence_path).filter(Boolean))],
    });
    if (agentId) {
      try {
        await link.mutateAsync({ agentId, skillId: skill.id });
      } catch {
        /* linking is best-effort; the skill still lands in Skills Lab */
      }
    }
    onClose();
    router.push(`/skills/${skill.id}?tab=config`);
  };

  return (
    <Modal
      width={680}
      title={t("modal.title")}
      subtitle={name}
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
            disabled={pending || candidates.length === 0}
          >
            {pending ? t("modal.creating") : t("modal.create")}
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          {t("modal.mergedFrom", { count: candidates.length, repo: repoName })}
        </div>
        <FormField label={t("modal.fields.name")} required>
          <TextInput value={name} onChange={setName} mono />
        </FormField>
        <FormField label={t("modal.fields.description")}>
          <TextInput value={description} onChange={setDescription} />
        </FormField>
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
        <FormField label={t("modal.fields.body")} required>
          <Textarea value={body} onChange={setBody} rows={12} mono />
        </FormField>
      </div>
    </Modal>
  );
}
