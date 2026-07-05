import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import { NAV, SHORTCUTS } from "../nav";

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

/**
 * Phase 6 (T29 / AC-23) — the "Onboarding Tour" WORKSPACE nav item.
 *
 * Unit under test: `Sidebar`, exercising the real `NAV`/`SHORTCUTS` config.
 * The new item sits BETWEEN "Pull Requests" and "Project Context", links to
 * the active repo's tour (`:repoId` resolved by `resolveHref`), highlights via
 * `aria-current="page"` when `activeKey === "onboarding-tour"`, and carries its
 * own `g o` navigation shortcut.
 */
describe("Sidebar — Onboarding Tour nav item (T29/AC-23)", () => {
  it("renders 'Onboarding Tour' between Pull Requests and Project Context, linking to the active repo's tour", () => {
    render(<Sidebar ctx={{ repoId: "42" }} />);

    const pulls = screen.getByRole("link", { name: /pull requests/i });
    const onboarding = screen.getByRole("link", { name: /onboarding tour/i });
    const context = screen.getByRole("link", { name: /project context/i });

    // :repoId is resolved from the active repo.
    expect(onboarding).toHaveAttribute("href", "/repos/42/onboarding-tour");

    // Order: Pull Requests → Onboarding Tour → Project Context.
    expect(pulls.compareDocumentPosition(onboarding) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(onboarding.compareDocumentPosition(context) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("marks Onboarding Tour with aria-current='page' when it is the active key", () => {
    render(<Sidebar ctx={{ activeKey: "onboarding-tour" }} />);

    expect(screen.getByRole("link", { name: /onboarding tour/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /pull requests/i })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: /project context/i })).not.toHaveAttribute("aria-current");
  });

  it("lists the 'g o' shortcut for Onboarding Tour in the shortcut registry", () => {
    const entry = SHORTCUTS.find((s) => s.keys === "g o");
    expect(entry).toBeDefined();
    expect(entry?.label).toMatch(/onboarding tour/i);
    expect(entry?.group).toBe("Navigation");
  });
});

/**
 * Phase 7 (T27 / AC-20) — VERIFY-ONLY: the "Onboarding Tour" WORKSPACE nav item
 * + its `g o` shortcut already shipped (`vendor/ui/nav.ts`); the why-risk-brief
 * feature adds NO production code here. This is the RTM anchor
 * (`test_onboarding_tour_nav_present`) that pins their continued presence — if
 * either regresses, this fails. The detailed order / active-state / :repoId
 * behavior is covered above (T29/AC-23); this block asserts the invariants the
 * risk-brief phase depends on remain intact.
 *
 * Unit under test: the real `NAV`/`SHORTCUTS` config via `Sidebar` (no data
 * hooks, no providers). Expected output: an "Onboarding Tour" link (WORKSPACE
 * group, between "Pull Requests" and "Project Context") + a `g o` navigation
 * shortcut both still render.
 */
describe("test_onboarding_tour_nav_present (T27/AC-20 verify-only)", () => {
  it("still renders 'Onboarding Tour' between Pull Requests and Project Context with the Workflow icon config", () => {
    render(<Sidebar ctx={{ repoId: "7" }} />);

    const pulls = screen.getByRole("link", { name: /pull requests/i });
    const onboarding = screen.getByRole("link", { name: /onboarding tour/i });
    const context = screen.getByRole("link", { name: /project context/i });

    expect(onboarding).toHaveAttribute("href", "/repos/7/onboarding-tour");
    // WORKSPACE group order: Pull Requests → Onboarding Tour → Project Context.
    expect(pulls.compareDocumentPosition(onboarding) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(onboarding.compareDocumentPosition(context) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The nav item def itself still carries the Workflow icon + `g o` shortcut key.
    const def = NAV.flatMap((g) => g.items).find((i) => i.key === "onboarding-tour");
    expect(def).toMatchObject({ icon: "Workflow", gKey: "o" });
  });

  it("still lists the 'g o' shortcut for Onboarding Tour in the registry", () => {
    const entry = SHORTCUTS.find((s) => s.keys === "g o");
    expect(entry).toBeDefined();
    expect(entry?.label).toMatch(/onboarding tour/i);
    expect(entry?.group).toBe("Navigation");
  });
});
