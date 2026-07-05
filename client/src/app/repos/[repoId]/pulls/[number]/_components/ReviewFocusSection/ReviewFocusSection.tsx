/* ReviewFocusSection — the "REVIEW FOCUS — READ THESE FIRST" block: a full-width,
   ordered list of the brief's `review_focus[]` pointers, each a clickable
   `file:line` link + a one-line reason. Rendered below the intent/blast grid and
   the Description in the Overview tab.

   SECURITY: every string here (path + reason) is LLM-derived UNTRUSTED text. Paths
   and reasons are rendered as plain TEXT (React auto-escapes; no
   dangerouslySetInnerHTML, AC-21). File links resolve to a github.com blob URL via
   `githubBlobUrl` (https only — no `javascript:`) or degrade to plain mono text
   when repo/sha is unknown; MonoLink adds `rel="noopener noreferrer"` (AC-18/AC-21). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Badge, MonoLink } from "@devdigest/ui";
import type { ReviewFocusItem } from "@devdigest/shared";
import { useBrief } from "@/lib/hooks/brief";
import { usePullDetail } from "@/lib/hooks/core";
import { useActiveRepo } from "@/lib/repo-context";
import { githubBlobUrl } from "@/lib/github-urls";

interface ReviewFocusSectionProps {
  prId: string;
}

export function ReviewFocusSection({ prId }: ReviewFocusSectionProps) {
  const t = useTranslations("brief");
  const { data: brief, isLoading } = useBrief(prId);
  // Repo + head SHA come from the same client sources the diff/findings/blast use
  // (repo-context + pull detail), NOT the brief contract — enough to deep-link each
  // focus file to github.com/{repo}/blob/{headSha}/{file}#L{line}. Absent either ⇒
  // MonoLink degrades to plain mono text (INSIGHTS 2026-06-30).
  const { activeRepo } = useActiveRepo();
  const pull = usePullDetail(prId);

  // Loading / no brief / empty focus list → render nothing. The section is a
  // best-effort read-these-first aid and never blocks the Overview; the empty
  // states of the brief itself live in PrBriefCard.
  if (isLoading || !brief) return null;

  const items = brief.review_focus;
  if (items.length === 0) return null;

  const repoFullName = activeRepo?.full_name ?? null;
  const headSha = pull.data?.head_sha ?? null;

  return (
    <section>
      <SectionLabel
        icon="ListChecks"
        right={
          <Badge color="var(--accent-text)" bg="var(--accent-bg)">
            {items.length}
          </Badge>
        }
      >
        {t("reviewFocus.title")}
      </SectionLabel>

      <ol
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {items.map((item, i) => (
          <FocusRow
            key={`${item.path}:${item.line ?? "file"}:${i}`}
            item={item}
            repoFullName={repoFullName}
            headSha={headSha}
          />
        ))}
      </ol>
    </section>
  );
}

// ---- Private sub-components ----

/* One "read this first" row: a blue monospace `file:line` link + an em-dash + a
   one-line reason as plain text. Generous line spacing, no nested card. */
function FocusRow({
  item,
  repoFullName,
  headSha,
}: {
  item: ReviewFocusItem;
  repoFullName: string | null;
  headSha: string | null;
}) {
  const label = item.line != null ? `${item.path}:${item.line}` : item.path;
  return (
    <li
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 8,
        fontSize: 13.5,
        lineHeight: 1.6,
        minWidth: 0,
      }}
    >
      <span title={label} style={{ flexShrink: 0 }}>
        <MonoLink href={blobHref(repoFullName, headSha, item.path, item.line)}>{label}</MonoLink>
      </span>
      <span aria-hidden style={{ color: "var(--text-muted)", flexShrink: 0 }}>
        —
      </span>
      {/* reason is LLM-derived untrusted text — plain text, React auto-escapes. */}
      <span style={{ color: "var(--text-secondary)", minWidth: 0 }}>{item.reason}</span>
    </li>
  );
}

// ---- Helpers ----

/** github.com blob deep-link for a focus file at the PR head, or undefined when
    the repo/sha isn't known yet (→ MonoLink falls back to plain text). The head
    SHA pins line numbers (github-urls convention); a whole-file focus item (no
    line) links file-level (no #L). Always https (safe protocol, AC-18/AC-21). */
function blobHref(
  repoFullName: string | null,
  headSha: string | null,
  file: string,
  line?: number | null,
): string | undefined {
  return repoFullName && headSha
    ? githubBlobUrl(repoFullName, headSha, file, line ?? undefined)
    : undefined;
}
