import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalAgentDashboard } from "@devdigest/shared";
import evalMessages from "../../../../../messages/en/eval.json";
import { AgentDashboardView } from "./AgentDashboardView";

const runEval = { mutate: vi.fn(), isPending: false };
let dash: EvalAgentDashboard | undefined;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks/eval", () => ({
  useEvalDashboard: () => ({ data: dash, isLoading: false }),
  useRunAgentEvals: () => runEval,
  useCompareRuns: () => ({ data: undefined, isLoading: true }),
}));
vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => ({ data: [{ id: "a1", name: "Security" }] }) }));

afterEach(cleanup);

function suite(v: number, id = `s${v}`) {
  return { id, workspace_id: "w", agent_id: "a1", agent_version: v, status: "done" as const, recall: 0.9, precision: 0.85, citation_accuracy: 0.95, passed: 17, total: 20, cost_usd: 0.05, duration_ms: 1000, ran_at: new Date().toISOString() };
}

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <AgentDashboardView agentId="a1" />
    </NextIntlClientProvider>,
  );
}

describe("AgentDashboardView (AC-34/AC-35/AC-18)", () => {
  it("shows the alert banner, metric cards, and enables Compare only at 2 selected", () => {
    dash = {
      agent_id: "a1", agent_name: "Security", model: "gpt-4.1", cases_total: 3,
      current: { recall: 0.9, precision: 0.85, citation_accuracy: 0.95, traces_passed: 17, traces_total: 20, cost_usd: 0.05 },
      delta: { recall: 0, precision: -0.02, citation_accuracy: 0 },
      trend: [
        { suite_run_id: "s6", ran_at: new Date().toISOString(), agent_version: 6, recall: 0.9, precision: 0.87, citation_accuracy: 0.95, pass_rate: 0.85, cost_usd: 0.05 },
        { suite_run_id: "s7", ran_at: new Date().toISOString(), agent_version: 7, recall: 0.9, precision: 0.85, citation_accuracy: 0.95, pass_rate: 0.85, cost_usd: 0.05 },
      ],
      recent_runs: [suite(7), suite(6)],
      alert: "Precision dipped 2pts on v7",
    };
    renderView();

    expect(screen.getByRole("alert")).toHaveTextContent("Precision dipped 2pts on v7");
    expect(screen.getByText("Run eval")).toBeInTheDocument();
    expect(screen.getByText("gpt-4.1")).toBeInTheDocument();

    const compareBtn = screen.getByText("Compare").closest("button")!;
    expect(compareBtn).toBeDisabled();

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!);
    expect(compareBtn).toBeDisabled(); // only 1 selected
    fireEvent.click(checkboxes[1]!);
    expect(compareBtn).not.toBeDisabled(); // exactly 2 → enabled
  });

  it("shows no alert with fewer than two completed runs and renders null metrics as '—'", () => {
    dash = {
      agent_id: "a1", agent_name: "Security", model: "gpt-4.1", cases_total: 1,
      current: { recall: null, precision: null, citation_accuracy: null, traces_passed: 0, traces_total: 0, cost_usd: null },
      delta: { recall: null, precision: null, citation_accuracy: null },
      trend: [{ suite_run_id: "s7", ran_at: new Date().toISOString(), agent_version: 7, recall: null, precision: null, citation_accuracy: null, pass_rate: null, cost_usd: null }],
      recent_runs: [suite(7)],
      alert: null,
    };
    renderView();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
