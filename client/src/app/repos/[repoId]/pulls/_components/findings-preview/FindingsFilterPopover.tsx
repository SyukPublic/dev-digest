/* FindingsFilterPopover — the shared findings popover used by BOTH the PR-list
   FINDINGS cell and the PR-detail timeline run rows. Severity chips filter the
   list (all levels on by default, reset on each open since it mounts fresh).
   Fixed-positioned + portaled to <body> to escape any clipping ancestor.
   Callers resolve the findings + counts; an optional onPick drills in. */
"use client";

import React from "react";
import { createPortal } from "react-dom";
import { IconBtn, Skeleton, EmptyState, SeverityFilter, SEVERITY_LEVELS } from "@devdigest/ui";
import type { FindingRecord, PrFindingCounts, Severity } from "@devdigest/shared";
import { visibleFindings } from "../../[number]/_components/FindingsPanel/helpers";
import { FindingPreviewList } from "./FindingPreviewList";
import { s } from "./styles";

const DEFAULT_WIDTH = 400;

export function FindingsFilterPopover({
  counts,
  findings,
  loading = false,
  title,
  closeLabel,
  emptyTitle,
  emptyBody,
  anchor,
  width = DEFAULT_WIDTH,
  onClose,
  onPick,
}: {
  counts: PrFindingCounts;
  /** Already-resolved findings (e.g. non-dismissed) the chips filter over. */
  findings: FindingRecord[];
  loading?: boolean;
  title: string;
  closeLabel: string;
  emptyTitle: string;
  emptyBody: string;
  anchor: DOMRect;
  width?: number;
  onClose: () => void;
  onPick?: (finding: FindingRecord) => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  // Severity filter — fresh on every open (component mounts on open).
  const [active, setActive] = React.useState<Set<Severity>>(() => new Set(SEVERITY_LEVELS));
  const toggle = React.useCallback((sev: Severity) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(sev)) next.delete(sev);
      else next.add(sev);
      return next;
    });
  }, []);

  // Outside-click + Escape close.
  React.useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const shown = React.useMemo(
    () => visibleFindings(findings, false, active),
    [findings, active],
  );

  const left = Math.min(Math.max(anchor.left, 8), window.innerWidth - width - 8);
  const top = anchor.bottom + 6;

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      style={{ ...s.panel, top, left, width }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={s.header}>
        <span style={s.headerTitle}>{title}</span>
        <IconBtn icon="X" onClick={onClose} label={closeLabel} />
      </div>

      <div style={s.filterRow}>
        <SeverityFilter counts={counts} active={active} onToggle={toggle} />
      </div>

      {loading ? (
        <div style={s.loadingStack}>
          <Skeleton height={48} />
          <Skeleton height={48} />
        </div>
      ) : shown.length === 0 ? (
        <EmptyState icon="Filter" title={emptyTitle} body={emptyBody} />
      ) : (
        <FindingPreviewList findings={shown} onPick={onPick} />
      )}
    </div>,
    document.body,
  );
}
