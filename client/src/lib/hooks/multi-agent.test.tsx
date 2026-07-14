import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "../api";
import { useAgentEstimates, useLaunchMultiAgentRun, useMultiAgentRun } from "./multi-agent";

/**
 * L07 Phase 6 (T13 / AC-5, AC-9, AC-12, AC-17) — the Multi-Agent Review query
 * + mutation hooks.
 *
 * Unit under test: `useAgentEstimates` / `useLaunchMultiAgentRun` /
 * `useMultiAgentRun`. The `api` client (`lib/api.ts`) is the boundary and is
 * mocked — the hooks must talk to the API ONLY through it, at the documented
 * endpoints, and (for the multi-run read) poll while any column is `running`.
 */
vi.mock("../api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

afterEach(() => vi.clearAllMocks());

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries").mockImplementation(() => Promise.resolve());
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, invalidateSpy, wrapper };
}

describe("useAgentEstimates", () => {
  it("GETs /agents/estimates and exposes the per-agent estimates", async () => {
    const estimates = [
      { agent_id: "a1", agent_name: "Security", avg_duration_ms: 8200, avg_cost_usd: 0.06, sample_size: 4 },
      { agent_id: "a2", agent_name: "Perf", avg_duration_ms: null, avg_cost_usd: null, sample_size: 0 },
    ];
    vi.mocked(api.get).mockResolvedValue(estimates);
    const { wrapper } = setup();

    const { result } = renderHook(() => useAgentEstimates(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith("/agents/estimates");
    expect(result.current.data).toEqual(estimates);
  });
});

describe("useLaunchMultiAgentRun", () => {
  it("POSTs the selected agent ids as { agent_ids } and invalidates the PR's multi-run on success", async () => {
    const ack = { multi_run_id: "m1", pr_id: "pr1", runs: [{ run_id: "r1", agent_id: "a1", agent_name: "Security" }] };
    vi.mocked(api.post).mockResolvedValue(ack);
    const { invalidateSpy, wrapper } = setup();

    const { result } = renderHook(() => useLaunchMultiAgentRun(), { wrapper });

    result.current.mutate({ prId: "pr1", agentIds: ["a1", "a2"] });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.post).toHaveBeenCalledWith("/pulls/pr1/multi-agent-run", { agent_ids: ["a1", "a2"] });
    expect(result.current.data).toEqual(ack);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["multi-agent-run", "pr1"] });
  });
});

describe("useMultiAgentRun", () => {
  it("GETs /pulls/:id/multi-agent when a prId is provided", async () => {
    const run = { id: "m1", pr_id: "pr1", columns: [{ status: "done" }], conflicts: [] };
    vi.mocked(api.get).mockResolvedValue(run);
    const { wrapper } = setup();

    const { result } = renderHook(() => useMultiAgentRun("pr1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith("/pulls/pr1/multi-agent");
    expect(result.current.data).toEqual(run);
  });

  it("does NOT fetch while prId is null (query disabled until the PR resolves)", () => {
    const { wrapper } = setup();
    renderHook(() => useMultiAgentRun(null), { wrapper });
    expect(api.get).not.toHaveBeenCalled();
  });

  it("keeps polling (4s) while any column is still running", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(api.get).mockResolvedValue({ id: "m1", pr_id: "pr1", columns: [{ status: "running" }], conflicts: [] });
      const { wrapper } = setup();

      renderHook(() => useMultiAgentRun("pr1"), { wrapper });

      // Initial fetch settles.
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(api.get).toHaveBeenCalledTimes(1);

      // One refetch interval elapses → it polls again because a column is running.
      await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
      expect(api.get).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops polling once no column is running", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(api.get).mockResolvedValue({ id: "m1", pr_id: "pr1", columns: [{ status: "done" }], conflicts: [] });
      const { wrapper } = setup();

      renderHook(() => useMultiAgentRun("pr1"), { wrapper });

      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(api.get).toHaveBeenCalledTimes(1);

      // No running column → refetchInterval is false, so no further fetches.
      await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
      expect(api.get).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
