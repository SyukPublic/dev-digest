"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { useActiveRepo } from "@/lib/repo-context";
import { useRepoIntelStatus, useRefetchBlastOnReindex } from "@/lib/hooks/repo-intel";
import { IntentCard } from "../IntentCard";
import { BlastCard } from "../BlastCard";
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
      <div className="brief-grid">
        <IntentCard prId={prId} />
        <BlastCard prId={prId} />
      </div>

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
