import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { FindingRecord, PrFindingCounts } from "@devdigest/shared";
import { FindingsFilterPopover } from "./FindingsFilterPopover";

/* jsdom has no pointer-capture API and reports 0 for layout boxes. We stub the
   panel's measured height + pointer-capture so the placement/clamp/drag logic
   (which reads getBoundingClientRect().height + window.inner*) is exercisable. */

const PANEL_HEIGHT = 300;

const COUNTS: PrFindingCounts = { CRITICAL: 2, WARNING: 3, SUGGESTION: 1 };

const mkFinding = (id: string): FindingRecord => ({
  id,
  severity: "CRITICAL",
  category: "security",
  title: `Finding ${id}`,
  file: "src/x.ts",
  start_line: 1,
  end_line: 1,
  rationale: "why",
  suggestion: null,
  confidence: 0.9,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
});

const FINDINGS = [mkFinding("a"), mkFinding("b")];

/** Build a DOMRect-like anchor; only the fields the popover reads matter. */
const anchor = (over: Partial<DOMRect>): DOMRect =>
  ({ top: 100, bottom: 120, left: 200, right: 260, width: 60, height: 20, x: 200, y: 100, toJSON: () => ({}), ...over } as DOMRect);

let rectSpy: ReturnType<typeof vi.spyOn>;

// jsdom 25 ships no PointerEvent, so RTL's fireEvent.pointer* would dispatch a
// bare Event without clientX/clientY (and React's pointerdown listener wouldn't
// fire). Polyfill it as a MouseEvent carrying pointerId so the drag handlers
// receive real coordinates.
class PointerEventPolyfill extends MouseEvent {
  pointerId: number;
  constructor(type: string, params: PointerEventInit = {}) {
    super(type, params);
    this.pointerId = params.pointerId ?? 0;
  }
}

beforeEach(() => {
  // Deterministic viewport.
  Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
  if (typeof window.PointerEvent === "undefined") {
    window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
    globalThis.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
  }
  // The panel reports a fixed height; everything else reports 0 (jsdom default).
  rectSpy = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue({ height: PANEL_HEIGHT, width: 0, top: 0, left: 0, bottom: 0, right: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
});

afterEach(() => {
  rectSpy.mockRestore();
  cleanup();
});

const baseProps = {
  counts: COUNTS,
  findings: FINDINGS,
  title: "FINDINGS",
  closeLabel: "Close",
  emptyTitle: "None",
  emptyBody: "No findings",
  onClose: () => {},
};

const px = (v: string | undefined) => Number((v ?? "").replace("px", ""));

describe("FindingsFilterPopover placement (Issue #7-A)", () => {
  it("opens below the anchor when it fits", () => {
    render(<FindingsFilterPopover {...baseProps} anchor={anchor({ bottom: 120 })} />);
    const panel = screen.getByRole("dialog");
    // 120 (anchor.bottom) + 6 (gap) = 126, fits under 768.
    expect(px(panel.style.top)).toBe(126);
  });

  it("clamps/flips vertically when the anchor is near the viewport bottom", () => {
    // Anchor bottom close to viewport bottom: below would push the panel off-screen.
    render(<FindingsFilterPopover {...baseProps} anchor={anchor({ top: 740, bottom: 760 })} />);
    const panel = screen.getByRole("dialog");
    const top = px(panel.style.top);
    // Invariant: fully inside the viewport with the 8px margin.
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top + PANEL_HEIGHT).toBeLessThanOrEqual(768 - 8);
    // It should have flipped above the anchor: top - 6 - 300 = 740 - 306 = 434.
    expect(top).toBe(434);
  });
});

describe("FindingsFilterPopover width (Issue #6 / #7-B)", () => {
  it("uses the 720px card width in card-mode", () => {
    render(
      <FindingsFilterPopover {...baseProps} anchor={anchor({})} renderContent={<div>card</div>} />,
    );
    expect(px(screen.getByRole("dialog").style.width)).toBe(720);
  });

  it("clamps the card width to the viewport on a narrow screen", () => {
    Object.defineProperty(window, "innerWidth", { value: 600, configurable: true });
    render(
      <FindingsFilterPopover {...baseProps} anchor={anchor({})} renderContent={<div>card</div>} />,
    );
    // min(720, 600 - 16) = 584.
    expect(px(screen.getByRole("dialog").style.width)).toBe(584);
  });

  it("renders all three severity chips (Issue #6) at the widened list default", () => {
    render(<FindingsFilterPopover {...baseProps} anchor={anchor({})} />);
    // All three levels present in counts → three chips render in the filter row.
    expect(screen.getByRole("dialog").style.width).toBe("470px");
    expect(screen.getByText("CRITICAL")).toBeInTheDocument();
    expect(screen.getByText("WARNING")).toBeInTheDocument();
    expect(screen.getByText("SUGGESTION")).toBeInTheDocument();
  });
});

describe("FindingsFilterPopover drag (Issue #7-C)", () => {
  it("drags the panel by its header and clamps to the viewport", () => {
    render(<FindingsFilterPopover {...baseProps} anchor={anchor({ left: 200, bottom: 120 })} />);
    const panel = screen.getByRole("dialog");
    const header = screen.getByText("FINDINGS").parentElement as HTMLElement;
    const before = { top: px(panel.style.top), left: px(panel.style.left) };

    // Grab at the panel origin (rect.left/top mocked to 0 → offset = pointer).
    // move/up are bound on window during an active drag.
    fireEvent.pointerDown(header, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 250, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    const after = { top: px(panel.style.top), left: px(panel.style.left) };
    expect(after).not.toEqual(before);
    expect(after.left).toBe(300);
    expect(after.top).toBe(250);
  });

  it("clicking the close button does not start a drag and calls onClose", () => {
    const onClose = vi.fn();
    render(
      <FindingsFilterPopover {...baseProps} onClose={onClose} anchor={anchor({ bottom: 120 })} />,
    );
    const panel = screen.getByRole("dialog");
    const before = { top: px(panel.style.top), left: px(panel.style.left) };

    const closeBtn = screen.getByRole("button", { name: "Close" });
    // pointerdown on X is stopped (does not seed a drag), so the window move is a no-op.
    fireEvent.pointerDown(closeBtn, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 250, pointerId: 1 });
    fireEvent.click(closeBtn);

    expect({ top: px(panel.style.top), left: px(panel.style.left) }).toEqual(before);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("FindingsFilterPopover anchor identity-independence (CLIENT-hardening #2)", () => {
  it("keeps the dragged position when re-rendered with a NEW anchor object of the SAME coords", () => {
    const { rerender } = render(
      <FindingsFilterPopover {...baseProps} anchor={anchor({ left: 200, bottom: 120 })} />,
    );
    const panel = screen.getByRole("dialog");

    // Drag the panel away from its seed (same flow as the drag test).
    fireEvent.pointerDown(screen.getByText("FINDINGS").parentElement as HTMLElement, {
      clientX: 0,
      clientY: 0,
      pointerId: 1,
    });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 250, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    const dragged = { top: px(panel.style.top), left: px(panel.style.left) };
    expect(dragged).toEqual({ top: 250, left: 300 });

    // Re-render with a DIFFERENT DOMRect object carrying the SAME coordinates.
    // The placement effect depends on coords (not identity), so it must NOT re-seed.
    rerender(<FindingsFilterPopover {...baseProps} anchor={anchor({ left: 200, bottom: 120 })} />);

    expect({ top: px(panel.style.top), left: px(panel.style.left) }).toEqual(dragged);
  });

  it("re-seeds the position when the anchor coordinates actually change", () => {
    const { rerender } = render(
      <FindingsFilterPopover {...baseProps} anchor={anchor({ left: 200, bottom: 120 })} />,
    );
    const panel = screen.getByRole("dialog");

    // Drag away first so a re-seed is observable.
    fireEvent.pointerDown(screen.getByText("FINDINGS").parentElement as HTMLElement, {
      clientX: 0,
      clientY: 0,
      pointerId: 1,
    });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 250, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect({ top: px(panel.style.top), left: px(panel.style.left) }).toEqual({ top: 250, left: 300 });

    // Re-render with NEW coordinates → effect re-seeds from the new anchor.
    rerender(<FindingsFilterPopover {...baseProps} anchor={anchor({ left: 400, top: 300, bottom: 320 })} />);

    // Seeded below the new anchor: 320 (bottom) + 6 (gap) = 326; left clamps to 400.
    expect(px(panel.style.top)).toBe(326);
    expect(px(panel.style.left)).toBe(400);
  });
});

describe("FindingsFilterPopover behavior preserved", () => {
  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<FindingsFilterPopover {...baseProps} onClose={onClose} anchor={anchor({})} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
