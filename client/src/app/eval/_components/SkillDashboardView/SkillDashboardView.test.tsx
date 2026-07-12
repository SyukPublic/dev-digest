import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalSkillDashboard } from "@devdigest/shared";
import evalMessages from "../../../../../messages/en/eval.json";
import { SkillDashboardView } from "./SkillDashboardView";

const runEval = { mutate: vi.fn(), isPending: false };
let dash: EvalSkillDashboard | undefined;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks/eval", () => ({
  useSkillEvalDashboard: () => ({ data: dash, isLoading: false }),
  useRunSkillEvals: () => runEval,
  // pure helper — mirror the real predicate (module is fully mocked)
  anyRunning: (runs: Array<{ status: string }> | undefined) =>
    (runs ?? []).some((r) => r.status === "running"),
}));
// The host picker + compare modal have their own tests; stub them here. The
// picker auto-selects a host so the Run button is enabled (mirrors the real one).
vi.mock("@/components/eval/HostAgentPicker", () => ({
  HostAgentPicker: ({ value, onChange }: { value: string | null; onChange: (id: string) => void }) => {
    React.useEffect(() => {
      if (!value) onChange("h1");
    }, [value, onChange]);
    return <div>HOST_PICKER:{value ?? "none"}</div>;
  },
}));
vi.mock("@/components/eval/SkillCompareModal", () => ({
  SkillCompareModal: ({ a, b, onClose }: { a: string; b: string; onClose: () => void }) => (
    <div role="dialog">
      COMPARE:{a}:{b}
      <button onClick={onClose}>x</button>
    </div>
  ),
}));

afterEach(cleanup);

function suite(v: number, id = `s${v}`) {
  return {
    id,
    workspace_id: "w",
    skill_id: "k1",
    skill_name: "No-secrets",
    skill_version: v,
    host_agent_id: "a1",
    host_agent_name: "Security",
    host_agent_version: 7,
    status: "done" as const,
    recall: 0.8,
    precision: 0.75,
    citation_accuracy: 0.9,
    passed: 12,
    total: 15,
    cost_usd: 0.1,
    duration_ms: 2000,
    ran_at: new Date().toISOString(),
  };
}

function trendPoint(v: number, id = `s${v}`) {
  return {
    suite_run_id: id,
    ran_at: new Date().toISOString(),
    skill_version: v,
    host_agent_id: "a1",
    host_agent_version: 7,
    recall: 0.8,
    precision: 0.75,
    citation_accuracy: 0.9,
    pass_rate: 0.8,
    cost_usd: 0.1,
  };
}

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <SkillDashboardView skillId="k1" />
    </NextIntlClientProvider>,
  );
}

describe("SkillDashboardView (AC-26/AC-27/AC-28)", () => {
  it("shows the alert banner + delta cards, and enables Compare only at 2 selected", () => {
    dash = {
      skill_id: "k1",
      skill_name: "No-secrets",
      cases_total: 3,
      current: { recall: 0.8, precision: 0.75, citation_accuracy: 0.9, traces_passed: 12, traces_total: 15, cost_usd: 0.1 },
      delta: { recall: 0, precision: -0.02, citation_accuracy: 0 },
      trend: [trendPoint(3, "s3"), trendPoint(4, "s4")],
      recent_runs: [suite(4), suite(3)],
      alert: "Precision dipped 2pts on skill v4",
    };
    renderView();

    expect(screen.getByRole("alert")).toHaveTextContent("Precision dipped 2pts on skill v4");
    // header shows skill name + latest version badge (v4 also appears in the table rows)
    expect(screen.getByText("No-secrets")).toBeInTheDocument();
    expect(screen.getAllByText("v4").length).toBeGreaterThan(0);
    // host picker resolved a host → Run button idle (all runs terminal)
    expect(screen.getByText("Run evals").closest("button")).not.toBeDisabled();

    const compareBtn = screen.getByText("Compare").closest("button")!;
    expect(compareBtn).toBeDisabled();

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!);
    expect(compareBtn).toBeDisabled(); // only 1 selected
    fireEvent.click(checkboxes[1]!);
    expect(compareBtn).not.toBeDisabled(); // exactly 2 → enabled

    // opening Compare renders the (stubbed) SkillCompareModal
    fireEvent.click(compareBtn);
    expect(screen.getByRole("dialog")).toHaveTextContent("COMPARE:s4:s3");
  });

  it("shows no alert with fewer than two completed runs and renders null metrics as '—'", () => {
    dash = {
      skill_id: "k1",
      skill_name: "No-secrets",
      cases_total: 1,
      current: { recall: null, precision: null, citation_accuracy: null, traces_passed: 0, traces_total: 0, cost_usd: null },
      delta: { recall: null, precision: null, citation_accuracy: null },
      trend: [trendPoint(4, "s4")],
      recent_runs: [suite(4)],
      alert: null,
    };
    renderView();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("keeps the Run button in the loading state while a suite is running", () => {
    dash = {
      skill_id: "k1",
      skill_name: "No-secrets",
      cases_total: 3,
      current: { recall: 0.8, precision: 0.75, citation_accuracy: 0.9, traces_passed: 12, traces_total: 15, cost_usd: 0.1 },
      delta: { recall: null, precision: null, citation_accuracy: null },
      trend: [],
      recent_runs: [{ ...suite(5), status: "running" as const }, suite(4)],
      alert: null,
    };
    renderView();
    // fire-and-forget suite → busy binds to the running suite, not the mutation
    expect(screen.getByText("Run evals").closest("button")).toBeDisabled();
  });
});
