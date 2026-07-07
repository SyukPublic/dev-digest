/* OnboardingTourView — the Onboarding Tour page (CP-7). Breadcrumb
   `owner/repo › Onboarding Tour`, an `H1 Onboarding for <repo>` (repo as code),
   a meta line (`Generated from index of N files · last refreshed X ago`), an
   in-page TOC, and the seven section cards in FIXED order (AC-1, AC-12).

   States: loading skeleton (AC-13); no-tour empty state + Generate (AC-6);
   degraded fact-only skeleton + degraded badge (AC-9); staleness badge (AC-10);
   generating progress + disabled control (AC-7). The query is keyed by the active
   repoId so a repo switch shows the current repo's tour (AC-11). Share copies the
   page's workspace URL + toast — no public link (AC-21). All model body renders
   via <Markdown>/<MermaidDiagram> as data, never as script (AC-16). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, CollapsibleCard, EmptyState, ErrorState, Icon, OnThisPage, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useActiveRepo } from "@/lib/repo-context";
import { useToast } from "@/lib/toast";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import type { Crumb } from "@devdigest/ui";
import type { OnboardingSection } from "@devdigest/shared";
import { useOnboardingTour, useGenerateOnboardingTour } from "@/lib/hooks/onboarding-tour";
import { SECTION_ORDER, relativeTimeAgo } from "./helpers";
import {
  ArchitectureSection,
  FirstTasksSection,
  GettingStartedSection,
  NarrativeSection,
  ReadingPathSection,
} from "./sections";
import { s } from "./styles";

export function OnboardingTourView() {
  const t = useTranslations("onboarding");
  const { repoId, activeRepo } = useActiveRepo();
  const { data, isLoading, isError, refetch } = useOnboardingTour(repoId);
  const generate = useGenerateOnboardingTour();
  const toast = useToast();

  useDocumentTitle(`${t("title")} · DevDigest`);

  const repoName = activeRepo?.name ?? "";
  const repoFullName = activeRepo?.full_name ?? null;
  const ref = activeRepo?.default_branch ?? null;

  const crumb: Crumb[] = [
    { label: activeRepo?.full_name ?? t("repoFallback"), mono: true },
    { label: t("title") },
  ];

  const onGenerate = React.useCallback(() => {
    if (!repoId || generate.isPending) return;
    generate.mutate(repoId, {
      onError: () => toast.error(t("generateError")),
    });
  }, [repoId, generate, toast, t]);

  const onShare = React.useCallback(() => {
    if (typeof window === "undefined") return;
    void navigator.clipboard?.writeText(window.location.href);
    toast.success(t("shareCopied"));
  }, [toast, t]);

  // ---- loading (AC-13) ----
  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.skeletonStack} aria-busy="true">
          <Skeleton height={40} />
          <Skeleton height={120} />
          <Skeleton height={120} />
          <Skeleton height={120} />
        </div>
      </AppShell>
    );
  }

  // ---- error ----
  if (isError || !data) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState title={t("loadError.title")} body={t("loadError.body")} onRetry={() => refetch()} />
      </AppShell>
    );
  }

  const { tour, meta } = data;
  const filesLine = t("meta.filesIndexed", { count: meta.filesIndexed });
  const refreshedAgo = relativeTimeAgo(meta.generatedAt);

  // ---- no tour + not degraded → empty state + Generate (AC-6) ----
  if (!tour && !meta.degraded) {
    return (
      <AppShell crumb={crumb}>
        <div style={{ padding: "24px 28px" }}>
          <Header
            repoName={repoName}
            title={t("heading", { repo: repoName })}
            filesLine={filesLine}
            refreshedAgo={refreshedAgo}
            metaSuffix={t("meta.refreshedNever")}
            degraded={false}
            stale={false}
            degradedLabel={t("badge.degraded")}
            staleLabel={t("badge.stale")}
          />
          <EmptyState
            icon="Sparkles"
            title={t("empty.title")}
            body={t("empty.body")}
            cta={t("actions.generate")}
            onCta={onGenerate}
            ctaLoading={generate.isPending}
          />
          {generate.isPending ? <GeneratingNote label={t("generating")} /> : null}
        </div>
      </AppShell>
    );
  }

  // Match the stored sections to the fixed display order (AC-1, AC-12). Missing
  // sections (degraded / partial) simply render nothing for that slot.
  const byKind = new Map<string, OnboardingSection>();
  for (const section of tour?.sections ?? []) byKind.set(section.kind, section);

  return (
    <AppShell crumb={crumb}>
      <div style={s.wrap}>
        <aside style={s.toc}>
          <OnThisPage
            label={t("onThisPage")}
            announce={(l) => t("onThisPageAnnounce", { section: l })}
            anchors={SECTION_ORDER.map((c) => ({ id: c.anchor, label: t(c.titleKey) }))}
          />
        </aside>

        <div style={s.content}>
          <Header
            repoName={repoName}
            title={t("heading", { repo: repoName })}
            filesLine={filesLine}
            refreshedAgo={refreshedAgo}
            metaSuffix={t("meta.refreshedNever")}
            degraded={meta.degraded}
            stale={meta.stale}
            degradedLabel={t("badge.degraded")}
            staleLabel={t("badge.stale")}
            actions={
              <>
                <Button kind="secondary" icon="RefreshCw" onClick={onGenerate} disabled={generate.isPending} loading={generate.isPending}>
                  {t("actions.regenerate")}
                </Button>
                <Button kind="secondary" icon="ExternalLink" onClick={onShare}>
                  {t("actions.share")}
                </Button>
              </>
            }
          />

          {generate.isPending ? <GeneratingNote label={t("generating")} /> : null}

          {SECTION_ORDER.map((cfg) => {
            const section = byKind.get(cfg.kind);
            return (
              <div key={cfg.kind} id={cfg.anchor}>
                <CollapsibleCard icon={cfg.icon} title={t(cfg.titleKey)} color={cfg.color}>
                  {section ? (
                    <SectionBody
                      section={section}
                      repoFullName={repoFullName}
                      gitRef={ref}
                      openLabel={t("actions.open")}
                      copyLabel={t("actions.copy")}
                    />
                  ) : (
                    // Degraded / missing section: honest placeholder, never fabricated.
                    <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("sectionUnavailable")}</div>
                  )}
                </CollapsibleCard>
              </div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}

/** Dispatch a section to its kind-specific renderer. */
function SectionBody({
  section,
  repoFullName,
  gitRef,
  openLabel,
  copyLabel,
}: {
  section: OnboardingSection;
  repoFullName: string | null;
  gitRef: string | null;
  openLabel: string;
  copyLabel: string;
}) {
  switch (section.kind) {
    case "architecture":
      return <ArchitectureSection section={section} />;
    case "reading_path":
      return (
        <ReadingPathSection
          section={section}
          repoFullName={repoFullName}
          gitRef={gitRef}
          openLabel={openLabel}
          copyLabel={copyLabel}
        />
      );
    case "getting_started":
      return <GettingStartedSection section={section} copyLabel={copyLabel} />;
    case "first_tasks":
      return <FirstTasksSection section={section} repoFullName={repoFullName} gitRef={gitRef} />;
    default:
      return <NarrativeSection section={section} />;
  }
}

/** Page header: H1 (repo as code), meta line, optional badges + action buttons. */
function Header({
  repoName,
  title,
  filesLine,
  refreshedAgo,
  metaSuffix,
  degraded,
  stale,
  degradedLabel,
  staleLabel,
  actions,
}: {
  repoName: string;
  title: string;
  filesLine: string;
  refreshedAgo: string | null;
  metaSuffix: string;
  degraded: boolean;
  stale: boolean;
  degradedLabel: string;
  staleLabel: string;
  actions?: React.ReactNode;
}) {
  // Split the localized heading around the repo token so the repo renders as code.
  const parts = title.split(repoName);
  return (
    <div style={s.header}>
      <div>
        <h1 style={s.h1}>
          {repoName && parts.length === 2 ? (
            <>
              {parts[0]}
              <code className="mono" style={s.h1Repo}>
                {repoName}
              </code>
              {parts[1]}
            </>
          ) : (
            title
          )}
        </h1>
        <div style={s.metaLine}>
          <span>{filesLine}</span>
          <span aria-hidden="true">·</span>
          <span>{refreshedAgo ?? metaSuffix}</span>
          {degraded ? (
            <Badge color="var(--warn, #fbbf24)" icon="AlertTriangle">
              {degradedLabel}
            </Badge>
          ) : null}
          {stale ? (
            <Badge color="var(--warn, #fbbf24)" icon="Clock">
              {staleLabel}
            </Badge>
          ) : null}
        </div>
      </div>
      {actions ? <div style={s.actions}>{actions}</div> : null}
    </div>
  );
}

/** Progress affordance shown while a generation is pending (AC-7). */
function GeneratingNote({ label }: { label: string }) {
  return (
    <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-secondary)" }}>
      <Icon.RefreshCw size={14} className="dd-spin" aria-hidden="true" />
      {label}
    </div>
  );
}
