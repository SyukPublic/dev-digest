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
});
