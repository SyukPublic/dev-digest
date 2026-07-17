import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentStats, Agent } from "@devdigest/shared";
import agents from "../../../../../../../../messages/en/agents.json";
import common from "../../../../../../../../messages/en/common.json";

// ---- Mocks ---------------------------------------------------------------
let statsState: {
  data: AgentStats | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => void;
};
vi.mock("@/lib/hooks/stats", () => ({
  useAgentStats: () => statsState,
}));

// The run-trace drawer pulls SSE/query hooks — stub it to a marker.
const drawerProps = vi.fn();
vi.mock("@/components/run-trace", () => ({
  __esModule: true,
  default: (props: { runId: string }) => {
    drawerProps(props);
    return <div data-testid="trace-drawer">trace {props.runId}</div>;
  },
}));

import { StatsTab } from "./StatsTab";

afterEach(cleanup);

const AGENT = { id: "ag1", name: "Security Reviewer" } as Agent;

function fullStats(over: Partial<AgentStats> = {}): AgentStats {
  return {
    agent_id: "ag1",
    agent_name: "Security Reviewer",
    runs: 142,
    findings_total: 20,
    accepted: 14,
    dismissed: 4,
    pending: 2,
    accept_rate: 0.78,
    dismiss_rate: 0.22,
    avg_findings_per_run: 0.14,
    total_cost_usd: 5.68,
    avg_cost_usd: 0.04,
    avg_latency_ms: 6200,
    avg_cost_delta_usd: -0.01,
    findings_by_severity: { CRITICAL: 5, WARNING: 10, SUGGESTION: 5 },
    trend: [
      { label: "a", value: 1 },
      { label: "b", value: 2 },
    ],
    most_used_skills: [{ name: "secret-leakage-gate", pct: 0.92 }],
    most_pulled_memory: [{ label: "raw-body parser integration note that is quite long", pct: 0.64 }],
    findings_by_category: [{ category: "security", count: 8 }],
    findings_by_severity_weekly: [
      { week: "w1", CRITICAL: 1, WARNING: 2, SUGGESTION: 1 },
      { week: "w2", CRITICAL: 0, WARNING: 1, SUGGESTION: 0 },
    ],
    run_history: [
      {
        run_id: "r1",
        ran_at: "2026-07-10T00:00:00Z",
        pr_number: 7,
        pr_id: "pr1",
        tokens: 150,
        cost_usd: null,
        findings_count: 2,
        source: "ci",
      },
    ],
    ...over,
  };
}

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents, common }}>
      <StatsTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

describe("Agent StatsTab (AC-22–27/35)", () => {
  beforeEach(() => {
    drawerProps.mockClear();
  });

  it("shows a loading skeleton while in flight (AC-5)", () => {
    statsState = { data: undefined, isLoading: true, isError: false, isFetching: true, refetch: vi.fn() };
    const { container } = renderTab();
    expect(container.querySelector(".skeleton")).toBeTruthy();
  });

  it("shows an error state using loadError on failure (AC-6)", () => {
    statsState = { data: undefined, isLoading: false, isError: true, isFetching: false, refetch: vi.fn() };
    renderTab();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/could not load agent stats/i)).toBeInTheDocument();
  });

  it("shows an empty state when there are no runs in the period (AC-18)", () => {
    statsState = { data: fullStats({ runs: 0 }), isLoading: false, isError: false, isFetching: false, refetch: vi.fn() };
    renderTab();
    expect(screen.getByText(/no runs in this period/i)).toBeInTheDocument();
  });

  it("renders cards, panels and a CI-badged run history; unpriced cost shows '—' (AC-7/22/26/35)", () => {
    statsState = { data: fullStats(), isLoading: false, isError: false, isFetching: false, refetch: vi.fn() };
    renderTab();
    expect(screen.getByText("142")).toBeInTheDocument(); // total runs
    expect(screen.getByText("78%")).toBeInTheDocument(); // accept-rate gauge
    expect(screen.getByText("secret-leakage-gate")).toBeInTheDocument(); // most-used skill
    // memory text renders as escaped text (long name present in DOM)
    expect(screen.getByText(/raw-body parser integration/)).toBeInTheDocument();
    // run history: CI source badge + unpriced cost dash
    expect(screen.getByText("CI")).toBeInTheDocument();
    expect(screen.getByText("#7")).toBeInTheDocument();
  });

  it("opens the run-trace drawer by run_id from a run-history row (AC-27)", () => {
    statsState = { data: fullStats(), isLoading: false, isError: false, isFetching: false, refetch: vi.fn() };
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /view trace/i }));
    expect(screen.getByTestId("trace-drawer")).toBeInTheDocument();
    expect(drawerProps).toHaveBeenCalledWith(expect.objectContaining({ runId: "r1" }));
  });
});
