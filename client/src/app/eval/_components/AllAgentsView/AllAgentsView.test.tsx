import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalWorkspaceDashboard } from "@devdigest/shared";
import evalMessages from "../../../../../messages/en/eval.json";
import { AllAgentsView } from "./AllAgentsView";

const runAll = { mutate: vi.fn(), isPending: false };
let data: EvalWorkspaceDashboard | undefined;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks/eval", () => ({
  useWorkspaceEvalDashboard: () => ({ data, isLoading: false }),
  useRunAllAgents: () => runAll,
  // pure helper — mirror the real predicate (module is fully mocked)
  anyRunning: (runs: Array<{ status: string }> | undefined) =>
    (runs ?? []).some((r) => r.status === "running"),
}));

afterEach(cleanup);

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <AllAgentsView />
    </NextIntlClientProvider>,
  );
}

describe("AllAgentsView (AC-32/AC-33)", () => {
  it("lists agents with metrics + a recent-runs table; never-run agents show '—'", () => {
    data = {
      agents: [
        { agent_id: "a1", agent_name: "Security", model: "gpt-4.1", enabled: true, cases_total: 3, current: { recall: 0.9, precision: 0.85, citation_accuracy: 0.95 }, sparklines: { recall: [0.8, 0.9], precision: [0.8, 0.85], citation_accuracy: [0.9, 0.95] }, last_run: { id: "s1", workspace_id: "w", agent_id: "a1", agent_version: 7, status: "done", recall: 0.9, precision: 0.85, citation_accuracy: 0.95, passed: 17, total: 20, cost_usd: 0.05, duration_ms: 1000, ran_at: new Date().toISOString(), agent_name: "Security" } },
        { agent_id: "a2", agent_name: "Perf", model: "gpt-4.1-mini", enabled: false, cases_total: 0, current: { recall: null, precision: null, citation_accuracy: null }, sparklines: { recall: [], precision: [], citation_accuracy: [] }, last_run: null },
      ],
      recent_runs: [
        { id: "s1", workspace_id: "w", agent_id: "a1", agent_name: "Security", agent_version: 7, status: "done", recall: 0.9, precision: 0.85, citation_accuracy: 0.95, passed: 17, total: 20, cost_usd: 0.05, duration_ms: 1000, ran_at: new Date().toISOString() },
      ],
    };
    renderView();
    // "Security" appears both in the agent row and the recent-runs table.
    expect(screen.getAllByText("Security").length).toBeGreaterThan(0);
    expect(screen.getByText("Perf")).toBeInTheDocument();
    expect(screen.getByText("gpt-4.1")).toBeInTheDocument();
    // never-run agent → "Never run" + "—" metrics
    expect(screen.getByText("Never run")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    // recent-runs table shows the run's pass tally
    expect(screen.getByText("17/20")).toBeInTheDocument();
    // short CITATION label in the agent rows (one per agent)
    expect(screen.getAllByText("CITATION").length).toBe(2);
    // all recent runs terminal → the Run-all button is idle
    expect(screen.getByText("Run all agents").closest("button")).not.toBeDisabled();
    // enabled agent row is full-opacity; disabled agent row renders dimmed
    // ("Security" also appears in the recent-runs table → pick the row button)
    const securityRow = screen
      .getAllByText("Security")
      .map((el) => el.closest("button"))
      .find((el) => el != null)!;
    expect(securityRow).toHaveStyle({ opacity: "1" });
    expect(screen.getByText("Perf").closest("button")).toHaveStyle({ opacity: "0.6" });
  });

  it("triggers run-all and shows the empty state when there are no agents", () => {
    data = { agents: [], recent_runs: [] };
    renderView();
    expect(screen.getByText(/No agents yet/)).toBeInTheDocument();
    screen.getByText("Run all agents").click();
    expect(runAll.mutate).toHaveBeenCalled();
  });

  it("keeps Run-all in the loading state while any suite is running", () => {
    data = {
      agents: [],
      recent_runs: [
        { id: "s9", workspace_id: "w", agent_id: "a1", agent_name: "Security", agent_version: 8, status: "running", recall: null, precision: null, citation_accuracy: null, passed: 0, total: 3, cost_usd: null, duration_ms: 0, ran_at: new Date().toISOString() },
      ],
    };
    renderView();
    // fire-and-forget run-all → busy binds to the running suite, not the mutation
    expect(screen.getByText("Run all agents").closest("button")).toBeDisabled();
  });
});
