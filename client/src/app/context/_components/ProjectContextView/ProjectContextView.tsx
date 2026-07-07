/* /context — Project Context page. Two-pane viewer: left = the discovered repo
   markdown docs (name + folder + type badge), right = a Preview | Edit viewer.
   Preview renders markdown via <Markdown>; Edit shows the RAW source READ-ONLY
   (no Save affordance in v1). Friendly empty state when no docs are discovered. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, EmptyState, ErrorState, Icon, Markdown, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useActiveRepo } from "@/lib/repo-context";
import { useProjectContextDocs, useDocumentContent } from "@/lib/hooks/project-context";
import { docName, folderColor, folderIcon, folderLabel } from "@/lib/project-context";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { s } from "./styles";

type ViewMode = "preview" | "edit";

export function ProjectContextView() {
  const t = useTranslations("context");
  const { repoId, activeRepo } = useActiveRepo();
  const { data: docs, isLoading, isError, refetch } = useProjectContextDocs(repoId);

  const [selected, setSelected] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<ViewMode>("preview");

  useDocumentTitle("Project Context · DevDigest");

  // Auto-select the first doc once the list resolves (nothing selected yet).
  React.useEffect(() => {
    if (!selected && docs && docs.length > 0) setSelected(docs[0]!.path);
  }, [docs, selected]);

  const list = docs ?? [];
  const activeDoc = list.find((d) => d.path === selected) ?? null;
  const { data: content, isLoading: contentLoading } = useDocumentContent(repoId, selected);

  const crumb = [{ label: "Workspace" }, { label: t("title") }];

  return (
    <AppShell crumb={crumb}>
      <div style={s.panes}>
        {/* left: file list */}
        <div style={s.left}>
          <div style={s.leftHead}>
            <div style={s.leftTitle}>{t("page.listHeading")}</div>
            <div style={s.leftSub}>{activeRepo?.name ?? t("page.repoFallback")}</div>
          </div>
          <div style={s.list}>
            {isLoading && (
              <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                <Skeleton height={34} />
                <Skeleton height={34} />
                <Skeleton height={34} />
              </div>
            )}
            {!isLoading &&
              list.map((doc) => {
                const Glyph = Icon[folderIcon(doc.folder_type)];
                const active = doc.path === selected;
                return (
                  <button
                    key={doc.path}
                    type="button"
                    onClick={() => setSelected(doc.path)}
                    style={s.fileBtn(active)}
                    aria-current={active ? "true" : undefined}
                  >
                    <Glyph size={14} style={{ color: folderColor(doc.folder_type), flexShrink: 0 }} aria-hidden />
                    <span className="mono" style={s.fileName}>
                      {docName(doc.path)}
                    </span>
                    <Badge color={folderColor(doc.folder_type)} mono>
                      {doc.folder_type}
                    </Badge>
                  </button>
                );
              })}
          </div>
        </div>

        {/* right: viewer */}
        <div style={s.right}>
          {isError ? (
            <ErrorState body={t("loadError")} onRetry={() => refetch()} />
          ) : !isLoading && list.length === 0 ? (
            <EmptyState icon="FileText" title={t("empty.title")} body={t("empty.body")} />
          ) : activeDoc ? (
            <>
              <div style={s.viewerHead}>
                <span className="mono" style={s.viewerTitle}>
                  {activeDoc.path}
                </span>
                <span style={s.usedBy}>
                  <Icon.Users size={12} />
                  {t("usedByAgents", { count: activeDoc.used_by_agents ?? 0 })}
                </span>
                <div style={s.toggle} role="tablist" aria-label={t("mode.label")}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === "preview"}
                    onClick={() => setMode("preview")}
                    style={s.toggleBtn(mode === "preview")}
                  >
                    {t("mode.preview")}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === "edit"}
                    onClick={() => setMode("edit")}
                    style={s.toggleBtn(mode === "edit")}
                  >
                    {t("mode.edit")}
                  </button>
                </div>
              </div>
              <div style={s.body}>
                {contentLoading && <Skeleton height={220} />}
                {!contentLoading && content && (
                  mode === "preview" ? (
                    <Markdown>{content.content}</Markdown>
                  ) : (
                    // Edit = raw source, READ-ONLY (no Save affordance in v1).
                    <pre className="mono" style={s.raw}>
                      {content.content}
                    </pre>
                  )
                )}
              </div>
            </>
          ) : (
            <div style={{ padding: 28 }}>
              <Skeleton height={220} />
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
