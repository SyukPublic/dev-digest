"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { notify } from "@/lib/toast";
import type { PrFile } from "@devdigest/shared";
import { SmartDiffViewer } from "../SmartDiffViewer";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /** PR base ref (e.g. "main"). When present, a hint clarifies that this view is
   *  the cumulative PR diff (base...head), not a single-commit diff. */
  base?: string;
}

export function DiffTab({ prId, filesCount, files, canComment, base }: DiffTabProps) {
  const t = useTranslations("shell");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);
  // Smart (risk-ordered) layout is the default view; toggle to the flat original.
  const [smart, setSmart] = React.useState(true);

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {!smart && commentCount > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments ? "Hide comments" : "Show comments"} ({commentCount})
              </Button>
            )}
            <div role="group" style={{ display: "inline-flex", gap: 4 }}>
              <Button kind="ghost" size="sm" active={smart} onClick={() => setSmart(true)}>
                {t("diffViewer.smartOrder")}
              </Button>
              <Button kind="ghost" size="sm" active={!smart} onClick={() => setSmart(false)}>
                {t("diffViewer.originalOrder")}
              </Button>
            </div>
          </div>
        }
      >
        Files changed · {filesCount} files
      </SectionLabel>
      {base && (
        <p
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            margin: "-8px 0 14px",
          }}
          title={t("diffViewer.cumulativeHintTooltip")}
        >
          {t("diffViewer.cumulativeHint", { base })}
        </p>
      )}
      {smart && prId ? (
        <SmartDiffViewer prId={prId} />
      ) : (
        <DiffViewer files={files} commenting={commenting} />
      )}
    </section>
  );
}
