import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import { SHORTCUTS } from "../nav";

afterEach(cleanup);

/**
 * FIX 4 (F4-1) — the "Project Context" WORKSPACE nav item.
 *
 * Unit under test: `Sidebar`, which renders the real `NAV` config array
 * (`vendor/ui/nav.ts`) via `NavItem` — no data hooks, no providers required.
 * Input: `<Sidebar ctx={{}} />` with the default (anchor-based) `Link`.
 * Stub/fake return: none — this deliberately exercises the actual production
 * `NAV`/`SHORTCUTS` config, since that config was previously unexercised by
 * any test (the smoke test only mounts the showcase gallery and diff viewer).
 * Expected output: a "Project Context" link pointing at `/context` renders
 * inside the WORKSPACE group, after "Pull Requests"; the `g x` shortcut is
 * present in the registry.
 */
describe("Sidebar — Project Context nav item (F4-1)", () => {
  it("renders 'Project Context' in the WORKSPACE group, after Pull Requests, linking to /context", () => {
    render(<Sidebar ctx={{}} />);

    const pulls = screen.getByRole("link", { name: /pull requests/i });
    const context = screen.getByRole("link", { name: /project context/i });
    expect(context).toHaveAttribute("href", "/context");

    // Both live in the same WORKSPACE group; Project Context comes after Pull Requests.
    expect(pulls.compareDocumentPosition(context) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("lists the 'g x' shortcut for Project Context in the shortcut registry", () => {
    const entry = SHORTCUTS.find((s) => s.keys === "g x");
    expect(entry).toBeDefined();
    expect(entry?.label).toMatch(/project context/i);
    expect(entry?.group).toBe("Navigation");
  });

  it("marks the active nav link with aria-current='page' and leaves others unset", () => {
    render(<Sidebar ctx={{ activeKey: "context" }} />);

    const context = screen.getByRole("link", { name: /project context/i });
    expect(context).toHaveAttribute("aria-current", "page");

    // A non-active item carries no aria-current.
    const pulls = screen.getByRole("link", { name: /pull requests/i });
    expect(pulls).not.toHaveAttribute("aria-current");
  });
});
