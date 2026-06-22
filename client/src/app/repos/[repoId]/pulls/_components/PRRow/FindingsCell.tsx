/* FindingsCell — the PR-list FINDINGS column: compact per-severity count badges
   that open a filterable findings popover on click. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import type { PrMeta } from "@/lib/types";
import { usePrReviews } from "@/lib/hooks/reviews";
import { s } from "../../styles";
import { SeverityCountBadges } from "@/components/findings/SeverityCountBadges";
import { FindingsFilterPopover } from "@/components/findings/FindingsFilterPopover";

export function FindingsCell({ pr, repoId }: { pr: PrMeta; repoId: string }) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const counts = pr.findings ?? null;
  const total = counts ? counts.CRITICAL + counts.WARNING + counts.SUGGESTION : 0;
  const ref = React.useRef<HTMLDivElement>(null);
  // Anchor rect drives the fixed-positioned popover; null ⇒ closed (and the
  // popover unmounts, so its filter state resets to "all" on next open).
  const [anchor, setAnchor] = React.useState<DOMRect | null>(null);
  const close = React.useCallback(() => setAnchor(null), []);

  // Lazy: only fetch the PR's findings while the popover is open.
  const { data: reviews, isLoading } = usePrReviews(anchor && pr.id ? pr.id : null);
  const nonDismissed = React.useMemo<FindingRecord[]>(
    () => (reviews ?? []).flatMap((r) => r.findings).filter((f) => !f.dismissed_at),
    [reviews],
  );

  if (!counts || total === 0) {
    return (
      <div style={s.findingsCell}>
        <span style={s.muted}>—</span>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      style={s.findingsCell}
      // Clicks here must never navigate the row (the row's onClick opens the PR).
      onClick={(e) => {
        e.stopPropagation();
        if (anchor) close();
        else if (pr.id && ref.current) setAnchor(ref.current.getBoundingClientRect());
      }}
    >
      <SeverityCountBadges counts={counts} />
      {anchor && pr.id && (
        <FindingsFilterPopover
          counts={counts}
          findings={nonDismissed}
          loading={isLoading}
          title={t("list.findingsPopover.count", { count: total })}
          closeLabel={t("list.findingsPopover.close")}
          emptyTitle={t("list.findingsPopover.emptyTitle")}
          emptyBody={t("list.findingsPopover.emptyBody")}
          anchor={anchor}
          onClose={close}
          onPick={() => {
            close();
            router.push(`/repos/${repoId}/pulls/${pr.number}`);
          }}
        />
      )}
    </div>
  );
}
