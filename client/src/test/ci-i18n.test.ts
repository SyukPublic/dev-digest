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

  it("test_ci_i18n: Remove-from-CI copy exists with {repo}/{agent} placeholders (AC-75)", () => {
    const remove = ci.remove;
    expect(remove.action).toBe("Remove from CI");
    // The row action label + confirm dialog name BOTH the agent and the repo.
    expect(remove.actionLabel).toContain("{agent}");
    expect(remove.actionLabel).toContain("{repo}");
    expect(remove.title.length).toBeGreaterThan(0);
    expect(remove.body).toContain("{agent}");
    expect(remove.body).toContain("{repo}");
    // A last-agent teardown warning, the confirm/cancel labels, and an error slot.
    expect(remove.lastAgentWarning).toContain("{repo}");
    expect(remove.confirm.length).toBeGreaterThan(0);
    expect(remove.cancel.length).toBeGreaterThan(0);
    expect(remove.error).toContain("{message}");
    expect(remove.success).toContain("{agent}");
  });
});
