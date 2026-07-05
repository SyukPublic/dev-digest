/* ContextPreviewDrawer — right-side drawer previewing a discovered doc (AC-17):
   full path title, folder-type badge, token count, "Used by N agents", an
   "Attached" chip when the doc is attached in the current editor, and the
   rendered markdown body. Reused by the agent + skill Context tabs and the
   Project Context page. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Drawer, Icon, Markdown, Skeleton } from "@devdigest/ui";
import type { DiscoveredDocument } from "@devdigest/shared";
import { useDocumentContent } from "@/lib/hooks/project-context";
import { folderColor } from "@/lib/project-context";
import { s } from "./styles";

export function ContextPreviewDrawer({
  repoId,
  doc,
  attached,
  onClose,
}: {
  repoId: string | null | undefined;
  doc: DiscoveredDocument;
  attached?: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("context");
  const { data, isLoading, isError } = useDocumentContent(repoId, doc.path);
  const usedBy = doc.used_by_agents ?? 0;

  return (
    <Drawer title={<span className="mono">{doc.path}</span>} onClose={onClose}>
      <div style={s.drawerMeta}>
        <Badge color={folderColor(doc.folder_type)} mono>
          {doc.folder_type}
        </Badge>
        {attached && (
          <Badge color="var(--ok)" icon="Check">
            {t("drawer.attached")}
          </Badge>
        )}
        <span style={s.drawerTokens}>{t("tokens", { count: data?.tokens ?? doc.tokens })}</span>
        <span style={s.drawerUsedBy}>
          <Icon.Users size={12} />
          {t("usedByAgents", { count: usedBy })}
        </span>
      </div>

      {isLoading && <Skeleton height={200} />}
      {isError && <p style={{ color: "var(--crit)", fontSize: 13 }}>{t("drawer.loadError")}</p>}
      {data && <Markdown>{data.content}</Markdown>}
    </Drawer>
  );
}
