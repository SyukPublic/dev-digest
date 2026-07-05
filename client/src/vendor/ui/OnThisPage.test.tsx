import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { OnThisPage, type OnThisPageAnchor } from "./OnThisPage";

afterEach(cleanup);

const anchors: OnThisPageAnchor[] = [
  { id: "overview", label: "Overview" },
  { id: "install", label: "Install" },
  { id: "usage", label: "Usage" },
];

describe("OnThisPage", () => {
  it("renders the label and one anchor link per section pointing at its id", () => {
    render(<OnThisPage anchors={anchors} label="On this page" activeId="overview" />);

    const nav = screen.getByRole("navigation", { name: /on this page/i });
    expect(within(nav).getByText("On this page")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "#overview");
    expect(screen.getByRole("link", { name: "Install" })).toHaveAttribute("href", "#install");
    expect(screen.getByRole("link", { name: "Usage" })).toHaveAttribute("href", "#usage");
  });

  it("marks the active anchor with aria-current and announces it politely", () => {
    render(
      <OnThisPage
        anchors={anchors}
        label="On this page"
        activeId="install"
        announce={(l) => `Viewing ${l}`}
      />,
    );

    // Only the active anchor carries aria-current.
    expect(screen.getByRole("link", { name: "Install" })).toHaveAttribute("aria-current", "location");
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");

    // The polite live region announces the active section.
    expect(screen.getByText("Viewing Install")).toBeInTheDocument();
  });

  it("is keyboard-navigable — anchors are focusable links with hrefs", () => {
    render(<OnThisPage anchors={anchors} label="On this page" activeId="overview" />);

    // Native anchors with href are in the tab order (keyboard-reachable) and
    // expose the link role. Each is focusable.
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link.tagName).toBe("A");
      expect(link).toHaveAttribute("href");
      link.focus();
      expect(link).toHaveFocus();
    }
  });
});
