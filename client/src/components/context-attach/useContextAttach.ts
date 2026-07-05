/* useContextAttach — local ordered/attached state for a Project Context attach
   surface (agent or skill Context tab). Mirrors the SkillsTab local-state model
   (attached first, in stored order; reorder via drag AND keyboard) but keyed by
   repo-relative PATH instead of a skill id. Persists the FULL ordered attached
   path set on every toggle/reorder. Net-new vs SkillsTab: keyboard reorder
   (move up/down) for AC-19. */
"use client";

import React from "react";
import type { DiscoveredDocument, SpecAttachment } from "@devdigest/shared";

export interface ContextAttachState {
  /** All rows to render, in display order (attached first, then the rest). */
  rows: DiscoveredDocument[];
  /** Whether a given path is currently attached. */
  isAttached: (path: string) => boolean;
  /** Ordered list of currently-attached paths (the injected order). */
  attachedPaths: string[];
  /** Attach/detach a path (persists). */
  toggle: (path: string) => void;
  /** Reorder: move the dragged path to before the target path (persists). */
  moveBefore: (dragPath: string, targetPath: string) => void;
  /** Keyboard reorder: shift a path one slot up/down within the full order (persists). */
  move: (path: string, dir: "up" | "down") => void;
  /** Drag bookkeeping (native HTML5 DnD). */
  dragPath: string | null;
  setDragPath: (p: string | null) => void;
  /** True until both inputs have resolved and local state is seeded. */
  ready: boolean;
}

/**
 * @param docs      discovered docs from the repo (may be undefined while loading)
 * @param attached  persisted attachments for this owner (may be undefined while loading)
 * @param persist   called with the full ordered attached-path set on every change
 */
export function useContextAttach(
  docs: DiscoveredDocument[] | undefined,
  attached: SpecAttachment[] | undefined,
  persist: (paths: string[]) => void,
): ContextAttachState {
  // Full display order of paths (attached first in stored order, then the rest).
  const [order, setOrder] = React.useState<string[] | null>(null);
  const [linked, setLinked] = React.useState<Set<string>>(new Set());
  const [dragPath, setDragPath] = React.useState<string | null>(null);

  // Seed once both queries resolve. The server-provided `docs` already include
  // any `missing: true` rows for attached-but-absent paths (AC-15) — so an
  // attached path that no longer resolves on the clone is present in `docs` and
  // still leads the list (checked + detachable) with NO client-side synthesis.
  React.useEffect(() => {
    if (!docs || !attached || order !== null) return;
    const attachedPaths = [...attached].sort((a, b) => a.order - b.order).map((a) => a.path);
    const discovered = docs.map((d) => d.path);
    const rest = discovered.filter((p) => !attachedPaths.includes(p));
    // Attached paths lead (including server-supplied missing rows); the rest follow.
    setOrder([...attachedPaths, ...rest]);
    setLinked(new Set(attachedPaths));
  }, [docs, attached, order]);

  const doPersist = React.useCallback(
    (nextOrder: string[], nextLinked: Set<string>) =>
      persist(nextOrder.filter((p) => nextLinked.has(p))),
    [persist],
  );

  const toggle = React.useCallback(
    (path: string) => {
      // Compute `next` and persist OUTSIDE the state updater. Keeping the impure
      // `doPersist` side effect out of the `setLinked` updater is what stops
      // React StrictMode's dev double-invoke from firing two concurrent POSTs
      // (the updater must be pure). Mirrors the proven SkillsTab pattern.
      const next = new Set(linked);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      setLinked(next);
      if (order) doPersist(order, next);
    },
    [linked, order, doPersist],
  );

  const moveBefore = React.useCallback(
    (dp: string, targetPath: string) => {
      if (!dp || dp === targetPath || !order) return;
      const cur = order.filter((p) => p !== dp);
      cur.splice(cur.indexOf(targetPath), 0, dp);
      setOrder(cur);
      setDragPath(null);
      doPersist(cur, linked);
    },
    [order, linked, doPersist],
  );

  const move = React.useCallback(
    (path: string, dir: "up" | "down") => {
      if (!order) return;
      const i = order.indexOf(path);
      const j = dir === "up" ? i - 1 : i + 1;
      if (i === -1 || j < 0 || j >= order.length) return;
      const cur = [...order];
      [cur[i], cur[j]] = [cur[j]!, cur[i]!];
      setOrder(cur);
      doPersist(cur, linked);
    },
    [order, linked, doPersist],
  );

  // Build display rows straight from the server-provided docs (which already
  // include any `missing: true` rows). No client-side `missing` synthesis: the
  // SERVER is the single source of the flag (FIX 3b / AC-15).
  const rows = React.useMemo<DiscoveredDocument[]>(() => {
    if (!order || !docs) return [];
    const byPath = new Map(docs.map((d) => [d.path, d]));
    return order.flatMap<DiscoveredDocument>((p) => {
      const found = byPath.get(p);
      return found ? [found] : [];
    });
  }, [order, docs]);

  const attachedPaths = React.useMemo(
    () => (order ?? []).filter((p) => linked.has(p)),
    [order, linked],
  );

  return {
    rows,
    isAttached: (path) => linked.has(path),
    attachedPaths,
    toggle,
    moveBefore,
    move,
    dragPath,
    setDragPath,
    ready: order !== null,
  };
}
