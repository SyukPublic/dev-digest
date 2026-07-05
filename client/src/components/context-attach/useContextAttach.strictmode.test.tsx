/* useContextAttach under React.StrictMode — regression guard for the attach race
   (docs/plans/project-context-attach-race-fix.md, AC-1). The bug was an impure
   side effect (doPersist) inside the setLinked updater: StrictMode's development
   double-invoke ran the updater twice, firing two concurrent POSTs. `toggle` now
   computes `next` and persists OUTSIDE the updater, so one toggle → one persist. */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { DiscoveredDocument, SpecAttachment } from "@devdigest/shared";
import { useContextAttach } from "./useContextAttach";

const DOCS: DiscoveredDocument[] = [
  { path: "specs/goal.md", folder_type: "specs", tokens: 10, used_by_agents: 0 },
  { path: "docs/design.md", folder_type: "docs", tokens: 20, used_by_agents: 0 },
];

const ATTACHED: SpecAttachment[] = [{ path: "specs/goal.md", order: 0 }];

const strictWrapper = ({ children }: { children: React.ReactNode }) => (
  <React.StrictMode>{children}</React.StrictMode>
);

describe("useContextAttach under React.StrictMode (AC-1)", () => {
  it("test_toggle_persists_once_under_strictmode: one toggle → exactly one persist call with the expected path set", () => {
    const persist = vi.fn();
    const { result } = renderHook(() => useContextAttach(DOCS, ATTACHED, persist), {
      wrapper: strictWrapper,
    });

    // Seeded: specs/goal.md attached. Attach docs/design.md.
    act(() => result.current.toggle("docs/design.md"));

    // Under StrictMode's double-invoke, the impure side effect must NOT run twice.
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(["specs/goal.md", "docs/design.md"]);
  });

  it("test_toggle_attach_detach_behavior_unchanged: attach/detach flips isAttached, attachedPaths reflects the toggle, moveBefore/move persist once each", () => {
    const persist = vi.fn();
    const { result } = renderHook(() => useContextAttach(DOCS, ATTACHED, persist), {
      wrapper: strictWrapper,
    });

    // Detach the seeded path → isAttached flips off, attachedPaths empties.
    act(() => result.current.toggle("specs/goal.md"));
    expect(result.current.isAttached("specs/goal.md")).toBe(false);
    expect(result.current.attachedPaths).toEqual([]);
    expect(persist).toHaveBeenLastCalledWith([]);

    // Re-attach → isAttached flips on, attachedPaths reflects it.
    act(() => result.current.toggle("specs/goal.md"));
    expect(result.current.isAttached("specs/goal.md")).toBe(true);
    expect(result.current.attachedPaths).toEqual(["specs/goal.md"]);

    // Attach the second doc so a reorder has two attached paths to swap.
    act(() => result.current.toggle("docs/design.md"));
    expect(result.current.attachedPaths).toEqual(["specs/goal.md", "docs/design.md"]);

    // moveBefore (drag) persists once and reorders the attached set.
    persist.mockClear();
    act(() => result.current.moveBefore("docs/design.md", "specs/goal.md"));
    expect(persist).toHaveBeenCalledTimes(1);
    expect(result.current.attachedPaths).toEqual(["docs/design.md", "specs/goal.md"]);

    // move (keyboard) persists once and shifts within the order.
    persist.mockClear();
    act(() => result.current.move("docs/design.md", "down"));
    expect(persist).toHaveBeenCalledTimes(1);
    expect(result.current.attachedPaths).toEqual(["specs/goal.md", "docs/design.md"]);
  });
});
