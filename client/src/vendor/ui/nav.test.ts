import { describe, it, expect } from "vitest";
import { NAV } from "./nav";

/* test_ci_runs_nav (AC-33) — the CI Runs item is reachable from the sidebar via
   a new GLOBAL section and points at /ci-runs. */
describe("NAV — GLOBAL CI Runs entry", () => {
  it("appends a GLOBAL section carrying the CI Runs item", () => {
    const global = NAV.find((g) => g.section === "GLOBAL");
    expect(global).toBeDefined();
    const item = global?.items.find((i) => i.key === "ci-runs");
    expect(item).toMatchObject({ key: "ci-runs", label: "CI Runs", href: "/ci-runs" });
    // Icon must be a real IconName (non-empty string).
    expect(typeof item?.icon).toBe("string");
    expect(item?.icon.length).toBeGreaterThan(0);
  });

  it("keeps the pre-existing WORKSPACE and SKILLS LAB sections intact", () => {
    const sections = NAV.map((g) => g.section);
    expect(sections).toEqual(["WORKSPACE", "SKILLS LAB", "GLOBAL"]);
  });
});
