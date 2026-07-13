import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalSkillCompareResult, EvalSkillSuiteRun } from "@devdigest/shared";
import evalMessages from "../../../../messages/en/eval.json";
import { SkillCompareModal } from "./SkillCompareModal";

let compareData: EvalSkillCompareResult | undefined;
vi.mock("@/lib/hooks/eval", () => ({
  useCompareSkillRuns: () => ({ data: compareData, isLoading: false }),
}));

afterEach(cleanup);

function suite(skillV: number, extra: Partial<EvalSkillSuiteRun> = {}): EvalSkillSuiteRun {
  return {
    id: `s${skillV}`, workspace_id: "w", skill_id: "sk", skill_name: "rubric", skill_version: skillV,
    host_agent_id: "a1", host_agent_name: "Alpha", host_agent_version: 3, status: "done",
    recall: 0.9, precision: 0.85, citation_accuracy: 0.95, passed: 8, total: 10,
    cost_usd: 0.05, duration_ms: 1000, ran_at: new Date().toISOString(), ...extra,
  };
}

function renderCompare() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <SkillCompareModal a="s1" b="s2" onClose={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("SkillCompareModal", () => {
  it("shows metric delta tiles, the skill-body diff and each run's host (AC-28)", () => {
    compareData = {
      run_a: suite(1, { precision: 0.87 }),
      run_b: suite(2),
      delta: { recall: 0, precision: -0.02, citation_accuracy: 0, cost_usd: 0.01 },
      skill_body_a: "# Rule\nBe terse.",
      skill_body_b: "# Rule\nBe strict.",
      host_changed: false,
    };
    renderCompare();
    expect(screen.getByText("Recall")).toBeInTheDocument();
    expect(screen.getByText("Precision")).toBeInTheDocument();
    expect(screen.getByText("Citation")).toBeInTheDocument();
    expect(screen.getByText("Cost")).toBeInTheDocument();
    // Body diff shows the changed (added) new-side line.
    expect(screen.getByText(/Be strict\./)).toBeInTheDocument();
    // Each run's host name + version is shown.
    expect(screen.getAllByText(/Alpha · v3/).length).toBeGreaterThan(0);
    // No confounder banner when the host did not change.
    expect(screen.queryByText(/Host changed between runs/)).not.toBeInTheDocument();
  });

  it("warns with a confounder banner when the host changed between runs (AC-29)", () => {
    compareData = {
      run_a: suite(1),
      run_b: suite(1, { host_agent_id: "a2", host_agent_name: "Beta", host_agent_version: 1 }),
      delta: { recall: 0, precision: 0, citation_accuracy: 0, cost_usd: 0 },
      skill_body_a: "x",
      skill_body_b: "x",
      host_changed: true,
    };
    renderCompare();
    expect(screen.getByText(/Host changed between runs/)).toBeInTheDocument();
  });

  it("degrades to 'body unavailable' when a skill_versions body is missing (AC-28)", () => {
    compareData = {
      run_a: suite(1),
      run_b: suite(2),
      delta: { recall: 0, precision: 0, citation_accuracy: 0, cost_usd: 0 },
      skill_body_a: null,
      skill_body_b: null,
      host_changed: false,
    };
    renderCompare();
    expect(screen.getByText("body unavailable")).toBeInTheDocument();
  });

  it("degrades to 'host unavailable' when a host name is missing (AC-28)", () => {
    compareData = {
      run_a: suite(1, { host_agent_name: null }),
      run_b: suite(2),
      delta: { recall: 0, precision: 0, citation_accuracy: 0, cost_usd: 0 },
      skill_body_a: "x",
      skill_body_b: "y",
      host_changed: false,
    };
    renderCompare();
    expect(screen.getByText("host unavailable")).toBeInTheDocument();
  });
});
