import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentPerf, AgentPerfRow } from "@devdigest/shared";
import agentPerformance from "../../../../../messages/en/agentPerformance.json";
import common from "../../../../../messages/en/common.json";

// ---- Mocks ---------------------------------------------------------------
let perfState: {
  data: AgentPerf | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => void;
};
vi.mock("@/lib/hooks/stats", () => ({
  useAgentPerformance: () => perfState,
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { AgentPerformanceView } from "./AgentPerformanceView";

afterEach(() => {
  cleanup();
  push.mockClear();
});

function row(over: Partial<AgentPerfRow> = {}): AgentPerfRow {
  return {
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "gpt-x",
    runs: 142,
    findings_total: 20,
    accepted: 14,
    dismissed: 4,
    accept_rate: 0.78,
    dismiss_rate: 0.22,
    avg_findings_per_run: 0.14,
    total_cost_usd: 5.68,
    avg_cost_usd: 0.04,
    avg_latency_ms: 6200,
    last_run_at: "2026-07-14T10:00:00Z",
    findings_by_severity: { CRITICAL: 5, WARNING: 10, SUGGESTION: 5 },
    trend: [1, 2, 3, 2, 4],
    accept_rate_delta: 0.05,
    ...over,
  };
}

function perf(over: Partial<AgentPerf> = {}): AgentPerf {
  return {
    summary: {
      runs: 253,
      total_cost_usd: 8.74,
      avg_accept_rate: 0.61,
      most_active_agent: "Security Reviewer",
      runs_trend: [10, 12, 8, 20],
      total_cost_delta_usd: -1.2,
    },
    agents: [row(), row({ agent_id: "a2", agent_name: "Perf Reviewer", accept_rate: 0.5, runs: 40 })],
    cost_by_agent: [{ label: "Security Reviewer", value: 5.68 }],
    cost_by_model: [{ label: "gpt-x", value: 8.74 }],
    ...over,
  };
}

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agentPerformance, common }}>
      <AgentPerformanceView />
    </NextIntlClientProvider>,
  );
}

describe("Agent Performance dashboard (AC-11–18)", () => {
  it("shows loading skeletons while in flight (AC-5)", () => {
    perfState = { data: undefined, isLoading: true, isError: false, isFetching: true, refetch: vi.fn() };
    const { container } = renderView();
    expect(container.querySelector(".skeleton")).toBeTruthy();
  });

  it("shows an error state on failure (AC-6)", () => {
    perfState = { data: undefined, isLoading: false, isError: true, isFetching: false, refetch: vi.fn() };
    renderView();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("shows an empty state when there are no runs (AC-18)", () => {
    perfState = { data: perf({ summary: { ...perf().summary, runs: 0 } }), isLoading: false, isError: false, isFetching: false, refetch: vi.fn() };
    renderView();
    expect(screen.getByText(/no agent runs yet/i)).toBeInTheDocument();
  });

  it("renders the summary cards, table default-sorted accept-rate desc, and cost donuts (AC-12/14/17)", () => {
    perfState = { data: perf(), isLoading: false, isError: false, isFetching: false, refetch: vi.fn() };
    renderView();
    // Title + subtitle (approved wording)
    expect(screen.getByRole("heading", { name: /agent performance/i })).toBeInTheDocument();
    expect(screen.getByText(/earn their keep/i)).toBeInTheDocument();
    // Most-active detail card
    expect(screen.getByText(/142 runs · 78% accept/)).toBeInTheDocument();
    // Table default sort accept-rate desc: Security Reviewer (0.78) before Perf Reviewer (0.5)
    const table = screen.getByRole("table", { name: /per-agent/i });
    const sec = within(table).getByRole("button", { name: /security reviewer/i });
    const perfR = within(table).getByRole("button", { name: /perf reviewer/i });
    expect(sec.compareDocumentPosition(perfR) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Cost donuts present
    expect(screen.getByText(/cost by agent/i)).toBeInTheDocument();
    expect(screen.getByText(/cost by model/i)).toBeInTheDocument();
  });

  it("expands a row to reveal a trend + caption (AC-16)", () => {
    perfState = { data: perf(), isLoading: false, isError: false, isFetching: false, refetch: vi.fn() };
    renderView();
    const expandButtons = screen.getAllByRole("button", { name: /toggle run trend/i });
    fireEvent.click(expandButtons[0]!);
    expect(screen.getByText(/last 5 runs · avg 6\.2s · \$0\.0400/)).toBeInTheDocument();
  });

  it("navigates to the agent Stats tab from the View action (AC-15)", () => {
    perfState = { data: perf(), isLoading: false, isError: false, isFetching: false, refetch: vi.fn() };
    renderView();
    fireEvent.click(screen.getAllByRole("button", { name: /^view$/i })[0]!);
    expect(push).toHaveBeenCalledWith("/agents/a1?tab=stats");
  });

  it("clicking the agent name expands the row and does NOT navigate (AC-15/16)", () => {
    perfState = { data: perf(), isLoading: false, isError: false, isFetching: false, refetch: vi.fn() };
    renderView();
    const table = screen.getByRole("table", { name: /per-agent/i });
    fireEvent.click(within(table).getByRole("button", { name: /security reviewer/i }));
    // Row expanded (trend caption shown), no navigation to the agent page.
    expect(screen.getByText(/last 5 runs · avg 6\.2s · \$0\.0400/)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
