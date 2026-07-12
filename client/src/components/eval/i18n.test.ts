import { describe, it, expect } from "vitest";
import evalMessages from "../../../messages/en/eval.json";
import skillsMessages from "../../../messages/en/skills.json";

/**
 * test_i18n_keys (T38) — the skill-eval UI strings must exist so the host picker,
 * delta view, skill-compare modal, Skills dashboard tab and the SkillEditor Evals
 * tab render real copy (not raw keys). English is the only locale.
 */
describe("skill eval i18n keys (T38)", () => {
  it("skills.json carries the SkillEditor Evals tab label", () => {
    expect(skillsMessages.editor.tabs.evals).toBe("Evals");
  });

  it("eval.json carries the host-picker keys (AC-4/AC-6)", () => {
    expect(evalMessages.hostPicker.label).toBeTruthy();
    expect(evalMessages.hostPicker.noEnabledHost).toBeTruthy();
    expect(evalMessages.hostPicker.runOnEvals).toBeTruthy();
  });

  it("eval.json carries the delta-view keys incl. caught/noise (AC-15/AC-30)", () => {
    expect(evalMessages.delta.empty).toBeTruthy();
    expect(evalMessages.delta.caught).toBe("caught");
    expect(evalMessages.delta.noise).toBe("noise");
  });

  it("eval.json carries the skill-compare + Skills-tab keys (AC-23/AC-28)", () => {
    expect(evalMessages.skillCompare.bodyDiff).toBeTruthy();
    expect(evalMessages.skillCompare.bodyUnavailable).toBeTruthy();
    expect(evalMessages.skillCompare.hostChanged).toBeTruthy();
    expect(evalMessages.tabs.skills).toBe("Skills");
    expect(evalMessages.tabs.agents).toBe("Agents");
  });
});
