import { describe, it, expect } from "vitest";
import { activeKeyFor } from "./helpers";

/**
 * Phase 6 (T29 / AC-23, recommendation 1) — `activeKeyFor` for the tour route.
 *
 * Pure function under test: `activeKeyFor(pathname)`. The Sidebar highlights the
 * item whose `key === activeKey`. Only the tour page (`/onboarding-tour`) may
 * resolve to `"onboarding-tour"`; the add-repo `/onboarding` wizard (a route with
 * NO sidebar item) must NOT highlight it and instead resolves to no active key.
 */
describe("activeKeyFor — onboarding-tour vs add-repo wizard", () => {
  it("returns 'onboarding-tour' for the per-repo tour page", () => {
    expect(activeKeyFor("/repos/42/onboarding-tour")).toBe("onboarding-tour");
  });

  it("does NOT highlight the tour for the add-repo /onboarding wizard", () => {
    expect(activeKeyFor("/onboarding")).not.toBe("onboarding-tour");
    // The wizard is not a nav item, so no sidebar entry is active.
    expect(activeKeyFor("/onboarding")).toBe("");
  });

  it("keeps resolving the sibling WORKSPACE routes unchanged", () => {
    expect(activeKeyFor("/repos/42/pulls")).toBe("pulls");
    expect(activeKeyFor("/context")).toBe("context");
  });
});
