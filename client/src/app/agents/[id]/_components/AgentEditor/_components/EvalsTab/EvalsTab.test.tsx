import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalCaseListItem } from "@devdigest/shared";
import evalMessages from "../../../../../../../../messages/en/eval.json";
import { EvalsTab } from "./EvalsTab";

const runAll = { mutate: vi.fn(), isPending: false };
const runCase = { mutate: vi.fn(), isPending: false };
const del = { mutate: vi.fn() };
let dashData: unknown;
let casesData: EvalCaseListItem[];
let runningIds: string[] = [];

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/lib/hooks/eval", () => ({
  anyRunning: (runs?: Array<{ status: string }>) => (runs ?? []).some((r) => r.status === "running"),
  useEvalDashboard: () => ({ data: dashData }),
  useAgentEvalCases: () => ({ data: casesData, isLoading: false }),
  useRunAgentEvals: () => runAll,
  useRunCase: () => runCase,
  useRunningCaseIds: () => runningIds,
  useDeleteEvalCase: () => del,
  // Present for CaseEditor (only mounted when a case is opened).
  useEvalCase: () => ({ data: undefined, isLoading: false }),
  useCreateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

afterEach(() => {
  runningIds = [];
  cleanup();
});

const AGENT = { id: "a1", name: "Security Reviewer", model: "gpt-4.1", provider: "openai" } as unknown as Agent;

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <EvalsTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

describe("EvalsTab (AC-7, AC-18)", () => {
  it("renders the metric summary, case list with status + chip, and the controls; null metrics show '—'", () => {
    dashData = {
      current: { recall: null, precision: 0.8, citation_accuracy: 0.9, traces_passed: 1, traces_total: 2, cost_usd: null },
    };
    casesData = [
      {
        id: "c1", name: "stripe-key-leak", expectation: "must_find", expected_count: 1,
        latest: { run_id: "r1", pass: true, recall: 1, precision: 1, citation_accuracy: 1, actual_count: 1, duration_ms: 1200, cost_usd: 0.02, ran_at: new Date().toISOString(), error: null },
      },
      {
        id: "c2", name: "clean-config", expectation: "must_not_flag", expected_count: 0, latest: null,
      },
    ];
    renderTab();

    // metric tiles — null recall renders "—"
    expect(screen.getByText("RECALL")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();

    // controls
    expect(screen.getByText("Run all evals")).toBeInTheDocument();
    expect(screen.getByText("New case")).toBeInTheDocument();
    expect(screen.getByText("View full dashboard →")).toBeInTheDocument();

    // case rows: names + statuses + expectation chips
    expect(screen.getByText("stripe-key-leak")).toBeInTheDocument();
    expect(screen.getByText("clean-config")).toBeInTheDocument();
    expect(screen.getByText("passed")).toBeInTheDocument();
    // "never run" appears as both the status label and the subtitle for c2.
    expect(screen.getAllByText("never run").length).toBeGreaterThan(0);
    // must_not_flag with empty findings → "empty []" chip
    expect(screen.getByText("empty []")).toBeInTheDocument();
  });

  it("triggers a suite run via 'Run all evals'", () => {
    dashData = { current: { recall: 1, precision: 1, citation_accuracy: 1, traces_passed: 1, traces_total: 1, cost_usd: null } };
    casesData = [{ id: "c1", name: "x", expectation: "must_find", expected_count: 1, latest: null }];
    renderTab();
    screen.getByText("Run all evals").click();
    expect(runAll.mutate).toHaveBeenCalled();
  });

  it("spins ONLY the cases with an in-flight run; others stay clickable (parallel runs allowed)", () => {
    dashData = { current: null };
    casesData = [
      { id: "c1", name: "case-one", expectation: "must_find", expected_count: 1, latest: null },
      { id: "c2", name: "case-two", expectation: "must_find", expected_count: 1, latest: null },
    ];
    runningIds = ["c1"];
    renderTab();

    const runButtons = screen.getAllByRole("button", { name: "Run" });
    expect(runButtons).toHaveLength(2);
    // The running row shows the spinner (loading also disables it)…
    expect(runButtons[0]!.querySelector(".dd-spin")).not.toBeNull();
    expect(runButtons[0]!).toBeDisabled();
    // …the other row neither spins nor is blocked — parallel runs are allowed.
    expect(runButtons[1]!.querySelector(".dd-spin")).toBeNull();
    expect(runButtons[1]!).not.toBeDisabled();
  });

  it("binds 'Run all evals' to the RUNNING suite, not the POST duration", () => {
    dashData = {
      current: null,
      recent_runs: [{ id: "s9", status: "running", agent_version: 2, ran_at: new Date().toISOString() }],
    };
    casesData = [{ id: "c1", name: "x", expectation: "must_find", expected_count: 1, latest: null }];
    renderTab();
    // While a suite is running the button spins, is disabled, and says Running…
    const btn = screen.getByRole("button", { name: /Running…/ });
    expect(btn).toBeDisabled();
    expect(btn.querySelector(".dd-spin")).not.toBeNull();
  });

  it("captions the metric tiles with the last completed suite run (version + date)", () => {
    dashData = {
      current: { recall: 1, precision: 1, citation_accuracy: 1, traces_passed: 3, traces_total: 3, cost_usd: 0.02 },
      recent_runs: [
        { id: "s2", status: "running", agent_version: 4, ran_at: new Date().toISOString() },
        { id: "s1", status: "done", agent_version: 3, ran_at: new Date().toISOString() },
      ],
    };
    casesData = [];
    renderTab();
    // Caption names the newest COMPLETED run (v3), skipping the running one.
    expect(screen.getByText(/last full suite run · v3 ·/)).toBeInTheDocument();
  });

  it("shows the empty state when the agent has no cases", () => {
    dashData = { current: { recall: null, precision: null, citation_accuracy: null, traces_passed: 0, traces_total: 0, cost_usd: null } };
    casesData = [];
    renderTab();
    expect(screen.getByText(/No eval cases yet/)).toBeInTheDocument();
  });
});
