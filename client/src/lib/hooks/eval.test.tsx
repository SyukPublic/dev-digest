import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EvalSuiteRun } from "@devdigest/shared";

const get = vi.fn();
vi.mock("../api", () => ({ api: { get: (...a: unknown[]) => get(...a), post: vi.fn(), put: vi.fn(), del: vi.fn() } }));

import { anyRunning, EVAL_POLL_MS, useEvalDashboard, useEvalSuite } from "./eval";

afterEach(() => {
  cleanup();
  get.mockReset();
});

const runningRun = { status: "running" } as Pick<EvalSuiteRun, "status">;
const doneRun = { status: "done" } as Pick<EvalSuiteRun, "status">;

describe("eval polling gate (AC-12)", () => {
  it("polls at 4s and only while a suite is running", () => {
    expect(EVAL_POLL_MS).toBe(4000);
    expect(anyRunning([runningRun])).toBe(true);
    expect(anyRunning([doneRun])).toBe(false);
    expect(anyRunning([])).toBe(false);
    expect(anyRunning(undefined)).toBe(false);
    // The dashboard hook maps this predicate to its refetchInterval (running →
    // EVAL_POLL_MS, terminal → false), so a poller stops on a terminal status.
    expect(anyRunning([doneRun]) ? EVAL_POLL_MS : false).toBe(false);
    expect(anyRunning([runningRun]) ? EVAL_POLL_MS : false).toBe(EVAL_POLL_MS);
  });

  it("useEvalDashboard loads via the API client", async () => {
    get.mockResolvedValue({ agent_id: "a1", agent_name: "A", model: "m", cases_total: 0, current: { recall: null, precision: null, citation_accuracy: null, traces_passed: 0, traces_total: 0, cost_usd: null }, delta: { recall: null, precision: null, citation_accuracy: null }, trend: [], recent_runs: [], alert: null });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useEvalDashboard("a1"), { wrapper });
    await waitFor(() => expect(result.current.data?.agent_id).toBe("a1"));
    expect(get).toHaveBeenCalledWith("/agents/a1/eval-dashboard");
  });
});

/**
 * Known-thin spot flagged by the implementer's own report: the poll GATE
 * (`anyRunning`) was unit-tested above, but never the actual timer-driven
 * refetch behavior. This closes that gap with real fake timers: unit under
 * test = `useEvalSuite`'s `refetchInterval`; input = a suite whose status the
 * mocked `api.get` returns as "running" then "done"; stub returns = one
 * resolved fetch per poll tick; expected output = a SECOND fetch fires after
 * exactly one EVAL_POLL_MS tick while running, and NO further fetch fires
 * once the suite reaches "done" (AC-12).
 */
describe("useEvalSuite polling behavior (AC-12, fake timers)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refetches at the 4s interval while running, then stops once the suite is terminal", async () => {
    vi.useFakeTimers();
    get.mockResolvedValueOnce({ suite: { status: "running" }, runs: [] });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useEvalSuite("s1"), { wrapper });

    await act(() => vi.waitFor(() => expect(result.current.data?.suite.status).toBe("running")));
    expect(get).toHaveBeenCalledTimes(1);

    // Still running → the 4s interval fires a second poll.
    get.mockResolvedValueOnce({ suite: { status: "running" }, runs: [] });
    await act(() => vi.advanceTimersByTimeAsync(EVAL_POLL_MS));
    await act(() => vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2)));

    // The suite is now terminal ("done") on this poll → the interval must STOP.
    get.mockResolvedValueOnce({ suite: { status: "done" }, runs: [] });
    await act(() => vi.advanceTimersByTimeAsync(EVAL_POLL_MS));
    await act(() => vi.waitFor(() => expect(result.current.data?.suite.status).toBe("done")));
    expect(get).toHaveBeenCalledTimes(3);

    // No further poll fires once the suite is terminal.
    await vi.advanceTimersByTimeAsync(EVAL_POLL_MS * 3);
    expect(get).toHaveBeenCalledTimes(3);
  });
});
