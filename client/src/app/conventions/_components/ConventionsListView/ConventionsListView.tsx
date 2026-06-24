/* /conventions — Conventions Extractor (fills the `conventions` scaffold).
   Scan the active repo, curate candidates (accept/reject/edit), then merge the
   accepted ones into a `repo-conventions` skill. The scan is a background job,
   so we poll the list while it runs (mirrors repo-intel index-state). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useActiveRepo } from "@/lib/repo-context";
import { useConventions, useExtractConventions, useUpdateConvention } from "@/lib/hooks/conventions";
import { ConventionCard, type ConventionEditPatch } from "../ConventionCard";
import { CreateSkillFromConventionsModal } from "../CreateSkillFromConventionsModal";
import { formatScanStamp, groupByCategory, newestStamp } from "./helpers";
import { s } from "./styles";

/** Stop polling after this long even if nothing changed (failed/empty scan). */
const SCAN_TIMEOUT_MS = 90_000;

export function ConventionsListView() {
  const t = useTranslations("conventions");
  const { repoId, activeRepo } = useActiveRepo();
  const [scanning, setScanning] = React.useState(false);
  const [showModal, setShowModal] = React.useState(false);

  const { data, isLoading, isError, refetch } = useConventions(repoId, scanning);
  const extract = useExtractConventions();
  const update = useUpdateConvention();

  const list = data ?? [];
  const stamp = newestStamp(list);
  const displayStamp = formatScanStamp(stamp);
  const prevStamp = React.useRef<string | null>(null);

  // A re-scan replaces rows with fresh `extracted_at` — stop polling once it changes.
  React.useEffect(() => {
    if (scanning && stamp && stamp !== prevStamp.current) setScanning(false);
  }, [scanning, stamp]);

  const repoName = activeRepo?.name ?? t("page.repoFallback");
  const accepted = list.filter((c) => c.accepted);
  const groups = groupByCategory(list);

  const onRescan = async () => {
    if (!repoId) return;
    prevStamp.current = stamp;
    setScanning(true);
    window.setTimeout(() => setScanning(false), SCAN_TIMEOUT_MS);
    try {
      await extract.mutateAsync(repoId);
    } catch {
      setScanning(false);
    }
  };

  const setAccepted = (id: string, value: boolean) => {
    if (repoId) update.mutate({ repoId, id, patch: { accepted: value } });
  };
  const saveEdit = (id: string, patch: ConventionEditPatch) => {
    if (repoId) update.mutate({ repoId, id, patch });
  };
  const deselectAll = () => accepted.forEach((c) => setAccepted(c.id, false));

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }]}>
      {showModal && (
        <CreateSkillFromConventionsModal
          repoName={repoName}
          candidates={accepted}
          onClose={() => setShowModal(false)}
        />
      )}
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>
              {t("page.headingPrefix")}
              <span style={s.repo}>{repoName}</span>
            </h1>
            <p style={s.subtitle}>{t("page.subtitle")}</p>
          </div>
          <Button kind="ghost" size="sm" icon="RefreshCw" onClick={onRescan} disabled={!repoId || scanning}>
            {scanning ? t("page.scanning") : t("page.rescan")}
          </Button>
          <Button
            kind="primary"
            size="sm"
            icon="Sparkles"
            onClick={() => setShowModal(true)}
            disabled={accepted.length === 0}
          >
            {t("page.createSkill")}
          </Button>
        </div>

        {!repoId && <EmptyState icon="ListChecks" title={t("page.empty.title")} body={t("page.selectRepo")} />}

        {repoId && (
          <>
            {list.length > 0 && (
              <div style={s.toolbar}>
                <span style={s.count}>
                  {t("page.acceptedCount", { accepted: accepted.length, total: list.length })}
                </span>
                {displayStamp && (
                  <span style={s.count}>{t("page.lastScan", { stamp: displayStamp })}</span>
                )}
                <div style={s.grow} aria-hidden />
                {accepted.length > 0 && (
                  <Button kind="ghost" size="sm" icon="X" onClick={deselectAll}>
                    {t("page.deselectAll")}
                  </Button>
                )}
              </div>
            )}

            {isLoading && (
              <div style={s.list}>
                <Skeleton height={140} />
                <Skeleton height={140} />
              </div>
            )}
            {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}
            {!isLoading && !isError && list.length === 0 && (
              <EmptyState
                icon="ListChecks"
                title={t("page.empty.title")}
                body={t("page.empty.body")}
                cta={scanning ? t("page.scanning") : t("page.empty.cta")}
                onCta={onRescan}
              />
            )}

            {groups.map((g) => (
              <div key={g.category} style={s.group}>
                <div style={s.groupTitle}>{g.category}</div>
                <div style={s.list}>
                  {g.items.map((c) => (
                    <ConventionCard
                      key={c.id}
                      candidate={c}
                      onAccept={() => setAccepted(c.id, true)}
                      onReject={() => setAccepted(c.id, false)}
                      onSaveEdit={(patch) => saveEdit(c.id, patch)}
                      busy={update.isPending}
                    />
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </AppShell>
  );
}
