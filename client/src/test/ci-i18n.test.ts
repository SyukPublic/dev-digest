/**
 * Phase 1 (L07 Export-to-CI) — CI i18n copy (test_block_merge_copy, AC-19).
 *
 * Guards the required `ci.json` corrections so the wizard/table/CI-tab surfaces
 * (Phases 3 & 4) find the strings they consume:
 *  - the Step-3 block-merge hint presents the "No GitHub App needed" guidance;
 *  - the CI Runs table has `agent` / `duration` / `trace` labels (AC-34);
 *  - the filters have `allSources` (AC-35);
 *  - the CI-tab buttons read "Update CI config" / "+ Add to CI".
 */
import { describe, it, expect } from "vitest";
import ci from "../../messages/en/ci.json";

describe("ci.json copy corrections", () => {
  it("block-merge hint uses the 'No GitHub App needed' guidance (AC-19)", () => {
    expect(ci.exportWizard.blockMergeDesc).toContain("No GitHub App needed");
    expect(ci.exportWizard.blockMergeDesc.toLowerCase()).toContain("required status check");
    // the stale "Requires a GitHub App" copy must be gone
    expect(ci.exportWizard.blockMergeDesc).not.toContain("Requires a GitHub App");
  });

  it("CI Runs table has agent / duration / trace labels (AC-34)", () => {
    expect(ci.runs.table.agent).toBe("Agent");
    expect(ci.runs.table.duration).toBe("Duration");
    expect(ci.runs.table.trace).toBe("Trace");
  });

  it("CI Runs filters include allSources (AC-35)", () => {
    expect(ci.runs.filters.allSources).toBe("All sources");
  });

  it("CI-tab button labels are aligned", () => {
    expect(ci.ciTab.updateConfig).toBe("Update CI config");
    expect(ci.ciTab.addToCi).toBe("+ Add to CI");
  });
});
