import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CollapsibleCard } from "./CollapsibleCard";

afterEach(cleanup);

describe("CollapsibleCard", () => {
  it("toggles the body on header click and reflects state via aria-expanded", () => {
    render(
      <CollapsibleCard icon="Settings" title="Configuration">
        <p>Body content</p>
      </CollapsibleCard>,
    );

    const header = screen.getByRole("button", { name: /configuration/i });

    // Starts open (defaultOpen).
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Body content")).toBeInTheDocument();

    // Click collapses.
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Body content")).not.toBeInTheDocument();

    // Click expands again.
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Body content")).toBeInTheDocument();
  });

  it("uses a native, keyboard-operable button for the toggle (Enter/Space work for free)", () => {
    render(
      <CollapsibleCard icon="FileText" title="Prompt" defaultOpen={false}>
        <p>Hidden body</p>
      </CollapsibleCard>,
    );

    const header = screen.getByRole("button", { name: /prompt/i });

    // The toggle is a real <button>, so browsers activate it via Enter/Space
    // (dispatching a click) and it is tab-focusable — no custom key handling
    // that could double-fire. Assert the semantics that guarantee this.
    expect(header.tagName).toBe("BUTTON");
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Hidden body")).not.toBeInTheDocument();

    // A keyboard activation ultimately dispatches a click on the button.
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Hidden body")).toBeInTheDocument();
  });

  // R4/R5.1 — additive props (titleSize, compact). Defaults must stay unchanged
  // for existing consumers; the expander semantics must be preserved. (AC-9,
  // AC-10, AC-11 — test_collapsible_card_additive)
  it("defaults the title to 14px (unchanged) and honors an additive smaller titleSize while staying bold", () => {
    const { rerender } = render(
      <CollapsibleCard icon="Settings" title="Default title">
        <p>body</p>
      </CollapsibleCard>,
    );
    // Default (no titleSize) → 14px, bold — identical to the original hardcode.
    expect(screen.getByText("Default title")).toHaveStyle({ fontSize: "14px", fontWeight: "600" });

    rerender(
      <CollapsibleCard icon="Settings" title="Small title" titleSize={13}>
        <p>body</p>
      </CollapsibleCard>,
    );
    // titleSize=13 → 13px, still bold (R4 risk title).
    expect(screen.getByText("Small title")).toHaveStyle({ fontSize: "13px", fontWeight: "600" });
  });

  it("keeps expander semantics (whole header toggles, aria-expanded, chevron) in the compact variant", () => {
    render(
      <CollapsibleCard icon="Info" title="How this is built" compact defaultOpen={false}>
        <p>Compact body</p>
      </CollapsibleCard>,
    );

    const header = screen.getByRole("button", { name: /how this is built/i });
    // Same expander behavior as the default variant.
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Compact body")).not.toBeInTheDocument();
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Compact body")).toBeInTheDocument();
  });
});
