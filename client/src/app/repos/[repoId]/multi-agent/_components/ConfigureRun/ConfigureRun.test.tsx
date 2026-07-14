import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import runsMessages from "../../../../../../../messages/en/runs.json";
import { ToastProvider } from "@/lib/toast";
import { ConfigureRun } from "./ConfigureRun";

// ---- Hook mocks (boundaries only) --------------------------------------------
const usePulls = vi.fn();
const useAgents = vi.fn();
const useAgentEstimates = vi.fn();
const launchMutate = vi.fn();

vi.mock("@/lib/hooks/core", () => ({ usePulls: () => usePulls() }));
vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => useAgents() }));
vi.mock("@/lib/hooks/multi-agent", () => ({
  useAgentEstimates: () => useAgentEstimates(),
  useLaunchMultiAgentRun: () => ({ mutate: launchMutate, isPending: false }),
}));

const AGENTS = [
  { id: "a1", name: "Security", enabled: true },
  { id: "a2", name: "Performance", enabled: true },
  { id: "a3", name: "Retired", enabled: false },
];
const ESTIMATES = [
  { agent_id: "a1", agent_name: "Security", avg_duration_ms: 12000, avg_cost_usd: 0.012, sample_size: 5 },
  { agent_id: "a2", agent_name: "Performance", avg_duration_ms: 8000, avg_cost_usd: 0.02, sample_size: 3 },
];
const PULLS = [{ id: "pr1", number: 482, title: "Add rate limiting to public API endpoints" }];

beforeEach(() => {
  usePulls.mockReturnValue({ data: PULLS, isLoading: false });
  useAgents.mockReturnValue({ data: AGENTS });
  useAgentEstimates.mockReturnValue({ data: ESTIMATES });
  launchMutate.mockReset();
});
afterEach(cleanup);

function renderConfigure(prId: string | null, handlers: { onSelectPr?: (id: string | null) => void; onLaunched?: (id: string) => void } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: runsMessages }}>
      <ToastProvider>
        <ConfigureRun
          repoId="r1"
          prId={prId}
          onSelectPr={handlers.onSelectPr ?? (() => {})}
          onLaunched={handlers.onLaunched ?? (() => {})}
        />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("ConfigureRun (test_configure_run)", () => {
  it("before a PR is picked: shows the PR select + a placeholder, run disabled, and reports PR selection", () => {
    const onSelectPr = vi.fn();
    renderConfigure(null, { onSelectPr });

    // Step 1 dropdown lists the PR.
    const select = screen.getByRole("combobox");
    expect(within(select).getByText(/#482 · Add rate limiting/)).toBeInTheDocument();

    // Step 2 is a "pick a PR first" placeholder — no agents yet.
    expect(screen.getByText("Pick a pull request first")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Security" })).not.toBeInTheDocument();

    // Launch is disabled at 0 selected (AC-8).
    expect(screen.getByRole("button", { name: /Run multi-agent review \(0\)/ })).toBeDisabled();

    // Selecting a PR is reported up (AC-3).
    fireEvent.change(select, { target: { value: "pr1" } });
    expect(onSelectPr).toHaveBeenCalledWith("pr1");
  });

  it("lists only enabled DB agents with per-agent history estimates (AC-4/AC-5)", () => {
    renderConfigure("pr1");

    expect(screen.getByRole("checkbox", { name: "Security" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Performance" })).toBeInTheDocument();
    // Disabled agents are not offered.
    expect(screen.queryByRole("checkbox", { name: "Retired" })).not.toBeInTheDocument();

    // Per-agent estimate from history: "12s · $0.0120".
    expect(screen.getByText(/12s · \$0\.0120/)).toBeInTheDocument();
    expect(screen.getByText(/8s · \$0\.0200/)).toBeInTheDocument();
  });

  it("composes the summed estimate as Σcost, MAX duration, then launches the selected set (AC-7/AC-9)", () => {
    const onLaunched = vi.fn();
    launchMutate.mockImplementation((_input, opts) => opts?.onSuccess?.());
    renderConfigure("pr1", { onLaunched });

    fireEvent.click(screen.getByRole("checkbox", { name: "Security" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Performance" }));

    // Summed: MAX(12s, 8s) = 12s; Σ(0.012 + 0.02) = 0.032 → "$0.0320".
    expect(screen.getByText(/≈ 12s · \$0\.0320 · parallel fan-out/)).toBeInTheDocument();

    const runBtn = screen.getByRole("button", { name: /Run multi-agent review \(2\)/ });
    expect(runBtn).toBeEnabled();
    fireEvent.click(runBtn);

    expect(launchMutate).toHaveBeenCalledTimes(1);
    expect(launchMutate.mock.calls[0]![0]).toEqual({ prId: "pr1", agentIds: ["a1", "a2"] });
    expect(onLaunched).toHaveBeenCalledWith("pr1");
  });

  it("shows the noAgents empty state when no agents are enabled (AC-6/AC-2)", () => {
    useAgents.mockReturnValue({ data: [{ id: "a3", name: "Retired", enabled: false }] });
    renderConfigure("pr1");
    expect(screen.getByText("Enable agents to run reviews")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run multi-agent review \(0\)/ })).toBeDisabled();
  });

  it("falls back to '—' when an agent has no run history (AC-6)", () => {
    useAgentEstimates.mockReturnValue({ data: [] });
    renderConfigure("pr1");
    // Both agent cards show the fallback orientation, not a fabricated number.
    expect(screen.getAllByText(/— · —/).length).toBeGreaterThanOrEqual(2);
  });
});
