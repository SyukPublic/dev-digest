"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Modal, FormField, TextInput, SelectInput, Textarea } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useCreateSkill } from "@/lib/hooks/skills";
import { SKILL_TYPE_VALUES } from "@/lib/skills";

/** Create-skill modal — a manually authored (trusted) skill. */
export function CreateSkillModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const create = useCreateSkill();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");
  const [body, setBody] = React.useState(t("create.defaultBody"));

  const submit = async () => {
    const skill = await create.mutateAsync({
      name: name.trim() || t("create.defaultName"),
      description,
      type,
      source: "manual",
      body,
    });
    onClose();
    router.push(`/skills/${skill.id}?tab=config`);
  };

  return (
    <Modal
      width={620}
      title={t("create.title")}
      subtitle={t("create.subtitle")}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button kind="ghost" onClick={onClose}>
            {t("create.cancel")}
          </Button>
          <Button kind="primary" icon="Plus" onClick={submit} disabled={create.isPending}>
            {create.isPending ? t("create.creating") : t("create.create")}
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <FormField label={t("create.fields.name")} required>
          <TextInput value={name} onChange={setName} placeholder={t("create.fields.namePlaceholder")} mono />
        </FormField>
        <FormField label={t("create.fields.description")} hint={t("config.descriptionHint")}>
          <TextInput
            value={description}
            onChange={setDescription}
            placeholder={t("create.fields.descriptionPlaceholder")}
          />
        </FormField>
        <FormField label={t("create.fields.type")}>
          <SelectInput
            value={type}
            onChange={(v) => setType(v as SkillType)}
            options={SKILL_TYPE_VALUES.map((v) => ({ value: v, label: t("listItem.type." + v) }))}
          />
        </FormField>
        <FormField label={t("create.fields.body")}>
          <Textarea value={body} onChange={setBody} rows={8} mono />
        </FormField>
      </div>
    </Modal>
  );
}
