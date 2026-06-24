/* Import a skill from a file (.md / .zip) or a URL. Two steps: parse → preview
   → save. The body is treated as untrusted data; a .zip yields only its markdown
   core. Imported skills are saved DISABLED until vetted. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Modal, Tabs, FormField, TextInput, Markdown, Badge } from "@devdigest/ui";
import type { SkillImportPreview } from "@devdigest/shared";
import { useImportSkill, useCreateSkill, type ImportSkillInput } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";

function fileToImportInput(file: File): Promise<ImportSkillInput> {
  const isZip = /\.zip$/i.test(file.name);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file"));
    if (isZip) {
      reader.onload = () => {
        const bytes = new Uint8Array(reader.result as ArrayBuffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
        resolve({ kind: "file", filename: file.name, data: btoa(binary), encoding: "base64" });
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = () =>
        resolve({ kind: "file", filename: file.name, data: String(reader.result), encoding: "utf8" });
      reader.readAsText(file);
    }
  });
}

export function ImportSkillModal({
  initialTab = "file",
  onClose,
}: {
  initialTab?: "file" | "url";
  onClose: () => void;
}) {
  const t = useTranslations("skills");
  const router = useRouter();
  const toast = useToast();
  const importSkill = useImportSkill();
  const create = useCreateSkill();

  const [tab, setTab] = React.useState<string>(initialTab);
  const [url, setUrl] = React.useState("");
  const [preview, setPreview] = React.useState<SkillImportPreview | null>(null);
  const [name, setName] = React.useState("");

  const runParse = async (input: ImportSkillInput) => {
    try {
      const p = await importSkill.mutateAsync(input);
      setPreview(p);
      setName(p.name);
    } catch (err) {
      toast.error(t("drawer.importFailed"));
    }
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await runParse(await fileToImportInput(file));
  };

  const save = async () => {
    if (!preview) return;
    const skill = await create.mutateAsync({
      name: name.trim() || preview.name,
      description: preview.description,
      type: preview.type,
      source: preview.source,
      body: preview.body,
      // Imported = untrusted → server forces disabled-until-vetted regardless.
      enabled: false,
    });
    toast.success(t("import.savedDisabled", { name: skill.name }));
    onClose();
    router.push(`/skills/${skill.id}?tab=config`);
  };

  const tabs = [
    { key: "file", label: t("drawer.tabs.file"), icon: "Upload" as const },
    { key: "url", label: t("drawer.tabs.url"), icon: "Link" as const },
  ];

  return (
    <Modal
      width={640}
      title={t("drawer.title")}
      subtitle={t("drawer.subtitle")}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("import.step", { n: preview ? 2 : 1 })}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
            {preview ? (
              <>
                <Button kind="ghost" onClick={() => setPreview(null)}>
                  {t("import.back")}
                </Button>
                <Button kind="primary" icon="Check" onClick={save} disabled={create.isPending}>
                  {create.isPending ? t("import.saving") : t("import.save")}
                </Button>
              </>
            ) : (
              <Button kind="ghost" onClick={onClose}>
                {t("create.cancel")}
              </Button>
            )}
          </div>
        </div>
      }
    >
      {!preview ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Tabs tabs={tabs} value={tab} onChange={setTab} pad="0" />
          {tab === "file" ? (
            <FormField label={t("import.fileLabel")} hint={t("import.fileHint")}>
              <input type="file" accept=".md,.markdown,.zip" onChange={onPickFile} />
            </FormField>
          ) : (
            <FormField label={t("url.label")} hint={t("url.hint")}>
              <div style={{ display: "flex", gap: 10 }}>
                <TextInput value={url} onChange={setUrl} placeholder={t("url.placeholder")} />
                <Button
                  kind="secondary"
                  onClick={() => runParse({ kind: "url", url })}
                  disabled={!url.trim() || importSkill.isPending}
                >
                  {importSkill.isPending ? t("import.parsing") : t("import.parse")}
                </Button>
              </div>
            </FormField>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <FormField label={t("file.nameLabel")} hint={t("file.nameHint")}>
            <TextInput value={name} onChange={setName} mono />
          </FormField>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <strong style={{ fontSize: 13 }}>{t("import.previewTitle")}</strong>
            <Badge color="var(--warn)">{t("preview.untrustedBadge")}</Badge>
          </div>
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 14,
              maxHeight: 320,
              overflow: "auto",
              background: "var(--bg-surface)",
              fontSize: 13,
            }}
          >
            <Markdown>{preview.body}</Markdown>
          </div>
        </div>
      )}
    </Modal>
  );
}
