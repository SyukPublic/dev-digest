import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { InDiffLink } from "./InDiffLink";

/* InDiffLink gap coverage — this component is exercised indirectly through
   IntentCard/ReviewFocusSection (which only fire a PLAIN left-click), so the
   "modified click keeps the browser default" branch (isModifiedClick) has no
   coverage anywhere else. Added here as the colocated unit test for the shared
   component (AC-3 navigation contract, AC-11 same-route-only href). */

const HREF = "/repos/r1/pulls/7?tab=diff&file=src%2Fa.ts&line=4-6";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderLink(onNavigate = vi.fn()) {
  render(<InDiffLink href={HREF} onNavigate={onNavigate}>src/a.ts:4-6</InDiffLink>);
  return { onNavigate };
}

describe("InDiffLink", () => {
  // Unit under test: InDiffLink. Input: href = same-route app query string,
  // children = plain text label. Expected: an <a> whose href is exactly the
  // given same-route URL (no protocol/host) and whose visible text is the
  // plain-text label (AC-11: no dangerouslySetInnerHTML, React auto-escape).
  it("renders an anchor with the same-route href and plain-text children", () => {
    renderLink();

    const link = screen.getByRole("link", { name: "src/a.ts:4-6" });
    expect(link).toHaveAttribute("href", HREF);
    expect(link.getAttribute("href")).not.toMatch(/^[a-z]+:\/\//i);
  });

  // Unit under test: InDiffLink's onClick handler for a PLAIN left-click.
  // Input: fireEvent.click(link, { button: 0 }) — no modifier keys.
  // Stub: onNavigate spy.
  // Expected: onNavigate is called exactly once with the anchor's href (in-app
  // client-side navigation; the default full-page navigation is prevented).
  it("navigates via the router on a plain left-click", () => {
    const { onNavigate } = renderLink();
    const link = screen.getByRole("link", { name: "src/a.ts:4-6" });

    fireEvent.click(link, { button: 0 });

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(HREF);
  });

  // Unit under test: InDiffLink's onClick handler for a MODIFIED click.
  // Input: dispatch a real (jsdom-native) MouseEvent with ctrlKey/metaKey/
  // shiftKey/altKey, or a non-primary button (middle-click, button: 1). Fake
  // timers keep jsdom's own (unimplemented) href-follow macrotask from ever
  // firing during the test, since we don't prevent its default action.
  // Stub: onNavigate spy.
  // Expected: onNavigate is NEVER called and the event's default action is NEVER
  // prevented for any of these — the click falls through to the browser's own
  // handling of the real href (new tab / window), matching isModifiedClick's
  // contract.
  it("does NOT intercept a modified click (ctrl/meta/shift/alt or non-primary button) — lets the browser handle it", () => {
    vi.useFakeTimers();
    const { onNavigate } = renderLink();
    const link = screen.getByRole("link", { name: "src/a.ts:4-6" });

    const modifierVariants: MouseEventInit[] = [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ];
    for (const init of modifierVariants) {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
      const preventDefaultSpy = vi.spyOn(event, "preventDefault");
      link.dispatchEvent(event);
      expect(preventDefaultSpy).not.toHaveBeenCalled();
    }

    expect(onNavigate).not.toHaveBeenCalled();
    // The href stays the safe same-route URL regardless (AC-11) — the browser's
    // own default action (e.g. opening a new tab) is what would use it.
    expect(link).toHaveAttribute("href", HREF);

    vi.useRealTimers();
  });
});
