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
import { visibleFindings } from "./helpers";
import { FindingPreviewList } from "./FindingPreviewList";
import { s } from "./styles";

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

/** List-default width — wide enough to fit the three SeverityFilter chips
    (CRITICAL/WARNING/SUGGESTION) in the `filterRow` on one line (Issue #6). */
const DEFAULT_WIDTH = 470;
/** Card-mode is wider than the list default to fit full FindingCards (markdown
    rationale + SUGGESTED FIX code blocks); ×1.5 the previous 480 (Issue #7). */
const CARD_WIDTH = 720;
/** Margin kept between the panel and every viewport edge. */
const VIEWPORT_MARGIN = 8;
/** Gap between the anchor and the panel when opening below/above it. */
const ANCHOR_GAP = 6;

export function FindingsFilterPopover({
  counts,
  findings,
  loading = false,
  title,
  closeLabel,
  emptyTitle,
  emptyBody,
  anchor,
  width,
  onClose,
  onPick,
  renderContent,
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
  /** Card-mode: when provided, the popover renders this instead of the
   *  FindingPreviewList and drops the SeverityFilter chips. The header (title +
   *  close X) is KEPT in both modes for usability. Used by the Smart Diff
   *  inline-tag path to show full FindingCards. */
  renderContent?: React.ReactNode;
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

  // Card-mode (renderContent set) is wider; an explicit width prop overrides.
  // Clamp the width so a wide card never exceeds the viewport on a narrow screen.
  const cardMode = renderContent !== undefined;
  const requestedWidth = width ?? (cardMode ? CARD_WIDTH : DEFAULT_WIDTH);
  const effectiveWidth =
    typeof window === "undefined"
      ? requestedWidth
      : Math.min(requestedWidth, window.innerWidth - 2 * VIEWPORT_MARGIN);

  // Position lives in state because dragging mutates it (a derived value can't be
  // dragged). It is seeded in useLayoutEffect — before paint — to avoid a flash
  // at the wrong spot. `null` only until that first layout pass runs.
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);

  // Initial placement: clamp X to the viewport (as before) and clamp/flip Y so
  // the panel is never pushed off-screen below the fold. Measures the rendered
  // panel height (capped at maxHeight:60vh) so the math uses the real size.
  // Depend on the anchor COORDINATES (primitives), not the DOMRect's identity, so
  // a caller that hands a fresh getBoundingClientRect() with the SAME coordinates
  // every render doesn't re-seed (and wipe a drag) on each render. Re-seed happens
  // only when the coordinates actually change.
  const { left: anchorLeft, top: anchorTop, bottom: anchorBottom } = anchor;
  React.useLayoutEffect(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const height = ref.current?.getBoundingClientRect().height ?? 0;

    const left = clamp(anchorLeft, VIEWPORT_MARGIN, vw - effectiveWidth - VIEWPORT_MARGIN);

    const below = anchorBottom + ANCHOR_GAP;
    const above = anchorTop - ANCHOR_GAP - height;
    let top: number;
    if (below + height <= vh - VIEWPORT_MARGIN) {
      top = below; // fits below the anchor (preferred)
    } else if (above >= VIEWPORT_MARGIN) {
      top = above; // flip above the anchor
    } else {
      top = clamp(below, VIEWPORT_MARGIN, vh - height - VIEWPORT_MARGIN); // pin in view
    }

    setPos({ top, left });
    // Coordinate (not identity) deps: re-seed only on a real position change;
    // a same-coords fresh-anchor render keeps the dragged position.
  }, [anchorLeft, anchorTop, anchorBottom, effectiveWidth]);

  // Drag (move) by the header. On pointerdown we record the cursor offset from
  // the panel's top-left and flag an active drag; pointermove/up are bound on
  // `window` (not the header) so the drag keeps following the cursor even when
  // it leaves the header — and so it works without pointer-capture. Each move
  // updates the same `pos` state, clamped to the viewport so the panel can't be
  // dragged off-screen. The close (X) button stops pointerdown propagation, so
  // clicking it never starts a drag.
  const dragRef = React.useRef<{ dx: number; dy: number } | null>(null);
  const [dragging, setDragging] = React.useState(false);

  const onHeaderPointerDown = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    setDragging(true);
  }, []);

  React.useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const height = ref.current?.getBoundingClientRect().height ?? 0;
      const left = clamp(
        e.clientX - drag.dx,
        VIEWPORT_MARGIN,
        window.innerWidth - effectiveWidth - VIEWPORT_MARGIN,
      );
      const top = clamp(
        e.clientY - drag.dy,
        VIEWPORT_MARGIN,
        window.innerHeight - height - VIEWPORT_MARGIN,
      );
      setPos({ top, left });
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, effectiveWidth]);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      style={{
        ...s.panel,
        top: pos?.top ?? anchor.bottom + ANCHOR_GAP,
        left: pos?.left ?? anchor.left,
        width: effectiveWidth,
        // Hide the pre-layout frame to avoid a flash at the unclamped position.
        visibility: pos ? "visible" : "hidden",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header (title + close X) is shown in BOTH modes. Card-mode drops only
          the SeverityFilter chips + the preview list. Drag-to-move grabs here. */}
      <div style={s.header} onPointerDown={onHeaderPointerDown}>
        <span style={s.headerTitle}>{title}</span>
        {/* Stop pointerdown on the close control so clicking X never starts a drag. */}
        <span onPointerDown={(e) => e.stopPropagation()}>
          <IconBtn icon="X" onClick={onClose} label={closeLabel} />
        </span>
      </div>

      {cardMode ? (
        <div style={s.cardBody}>{renderContent}</div>
      ) : (
        <>
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
        </>
      )}
    </div>,
    document.body,
  );
}
