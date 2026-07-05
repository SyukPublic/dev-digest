"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { useActiveRepo } from "@/lib/repo-context";
import { useRepoIntelStatus, useRefetchBlastOnReindex } from "@/lib/hooks/repo-intel";
import { IntentCard } from "../IntentCard";
import { BlastCard } from "../BlastCard";
import { PrBriefCard } from "../PrBriefCard";
import { ReviewFocusSection } from "../ReviewFocusSection";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string;
}

export function OverviewTab({ prBody, prId }: OverviewTabProps) {
  // Auto-refresh the Blast Radius card when a repo re-index COMPLETES (no manual
  // F5). We watch the index-state's completion signal (`lastIndexedSha`); the
  // status query self-polls while an index is running, so a mounted tab observes
  // the new sha and invalidates blast. See useRefetchBlastOnReindex for the why.
  const { repoId } = useActiveRepo();
  const { data: indexState } = useRepoIntelStatus(repoId);
  useRefetchBlastOnReindex(repoId, indexState?.lastIndexedSha ?? null);

  return (
    <>
      {/* PR BRIEF — the first block, above the intent/blast grid. Composed header
          (latest review) + brief body; full content width. */}
      <PrBriefCard prId={prId} />

      <div className="brief-grid">
        <IntentCard prId={prId} />
        <BlastCard prId={prId} />
      </div>

      {/* REVIEW FOCUS — full-width, framed like the Description box, and now
          placed BEFORE Description (R3, AC-7). It self-hides (renders nothing)
          when there is no brief / empty focus / loading, so the reorder never
          leaves an empty framed box above Description (AC-8). */}
      <ReviewFocusSection prId={prId} />

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
