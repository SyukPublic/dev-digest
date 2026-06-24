"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { RunSummary, PrCommit, ReviewRecord, FindingRecord } from "@devdigest/shared";
import { countBySeverity } from "@/components/findings/helpers";
import { FindingsFilterPopover } from "@/components/findings/FindingsFilterPopover";
import { CommitRow } from "./_components/CommitRow";
import { RunRow } from "./_components/RunRow";

/**
 * PR timeline — every agent run interleaved with the PR's commits, newest-first
 * and DB-backed so it survives reload. Showing commits between runs makes it
 * clear which commit each review ran against. This is the orchestrator: it sorts
 * the timeline, resolves each run's findings, and owns the findings popover;
 * row rendering lives in `_components/RunRow` and `_components/CommitRow`.
 */

type TimelineItem =
  | { kind: "run"; ts: number; run: RunSummary }
  | { kind: "commit"; ts: number; commit: PrCommit };

/** Epoch ms for sorting; unparseable / missing timestamps sort last. */
function tsOf(s: string | null | undefined): number {
  if (!s) return 0;
  const n = Date.parse(s);
  return Number.isNaN(n) ? 0 : n;
}

export function RunHistory({
  runs,
  commits = [],
  reviews = [],
  onOpenTrace,
  onGoToReview,
  onDelete,
}: {
  runs: RunSummary[];
  commits?: PrCommit[];
  /** Persisted reviews — used to list a run's findings in a popover (by run_id). */
  reviews?: ReviewRecord[];
  /** Open the trace + log drawer for a run (the logs icon). */
  onOpenTrace: (runId: string) => void;
  /** Jump to this run's inline review accordion below (clicking the agent name). */
  onGoToReview?: (runId: string) => void;
  onDelete?: (runId: string) => void;
}) {
  const t = useTranslations("prReview");
  // run_id → that run's findings (newest review per run wins; runs are 1:1 with reviews).
  const findingsByRun = React.useMemo(() => {
    const m = new Map<string, FindingRecord[]>();
    for (const r of reviews) {
      if (r.run_id && !m.has(r.run_id)) m.set(r.run_id, r.findings);
    }
    return m;
  }, [reviews]);
  const [openRun, setOpenRun] = React.useState<{ runId: string; anchor: DOMRect } | null>(null);

  if (runs.length === 0 && commits.length === 0) return null;

  const items: TimelineItem[] = [
    ...runs.map((run) => ({ kind: "run" as const, ts: tsOf(run.ran_at), run })),
    ...commits.map((commit) => ({ kind: "commit" as const, ts: tsOf(commit.committed_at), commit })),
  ].sort((a, b) => b.ts - a.ts);

  const findingsFor = (runId: string) =>
    (findingsByRun.get(runId) ?? []).filter((f) => !f.dismissed_at);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((item) =>
        item.kind === "commit" ? (
          <CommitRow key={`commit:${item.commit.sha}`} commit={item.commit} />
        ) : (
          <RunRow
            key={`run:${item.run.run_id}`}
            run={item.run}
            findings={findingsFor(item.run.run_id)}
            onOpenTrace={onOpenTrace}
            onGoToReview={onGoToReview}
            onDelete={onDelete}
            onOpenFindings={(runId, anchor) =>
              setOpenRun((prev) => (prev?.runId === runId ? null : { runId, anchor }))
            }
          />
        ),
      )}

      {openRun &&
        (() => {
          const f = findingsFor(openRun.runId);
          return (
            <FindingsFilterPopover
              counts={countBySeverity(f)}
              findings={f}
              title={t("timeline.findingsInRun", { count: f.length })}
              closeLabel={t("timeline.close")}
              emptyTitle={t("list.findingsPopover.emptyTitle")}
              emptyBody={t("list.findingsPopover.emptyBody")}
              anchor={openRun.anchor}
              onClose={() => setOpenRun(null)}
              onPick={() => {
                setOpenRun(null);
                onGoToReview?.(openRun.runId);
              }}
            />
          );
        })()}
    </div>
  );
}
