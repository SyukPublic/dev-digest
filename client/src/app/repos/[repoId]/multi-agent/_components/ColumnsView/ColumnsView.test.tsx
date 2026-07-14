import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { MultiAgentRun } from "@devdigest/shared";
import runsMessages from "../../../../../../../messages/en/runs.json";
import { ColumnsView } from "./ColumnsView";

const useRunEvents = vi.fn();
vi.mock("@/lib/hooks/reviews", () => ({ useRunEvents: (ids: string[]) => useRunEvents(ids) }));

const RUN: MultiAgentRun = {
  id: "mr1",
  pr_id: "pr1",
  pr_number: 482,
  ran_at: "2026-07-14T00:00:00Z",
  agent_count: 2,
  total_duration_ms: 12000,
  total_cost_usd: 0.07,
  conflicts: [],
  columns: [
    {
      run_id: "run-sec",
      agent_id: "a1",
      agent_name: "Security",
      provider: "openai",
      model: "gpt-4.1",
      status: "done",
      verdict: "request_changes",
      score: 38,
      summary: "Found issues",
      duration_ms: 12000,
      cost_usd: 0.05,
      findings: [
        { id: "f1", severity: "CRITICAL", category: "security", title: "Missing auth check", file: "src/api.ts", start_line: 12 },
      ],
    },
    {
      run_id: "run-perf",
      agent_id: "a2",
      agent_name: "Performance",
      provider: "openai",
      model: "gpt-4.1",
      status: "running",
      verdict: null,
      score: null,
      summary: null,
      duration_ms: null,
      cost_usd: null,
      findings: [],
    },
  ],
};

beforeEach(() => useRunEvents.mockReturnValue({ events: [], running: true }));
afterEach(cleanup);

function renderColumns(run: MultiAgentRun, onOpenTrace = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ runs: runsMessages }}>
      <ColumnsView run={run} onOpenTrace={onOpenTrace} />
    </NextIntlClientProvider>,
  );
  return onOpenTrace;
}

describe("ColumnsView (test_columns_view)", () => {
  it("renders a column per agent with score, status, and findings (AC-17/AC-19)", () => {
    renderColumns(RUN);

    expect(screen.getByText("Security")).toBeInTheDocument();
    expect(screen.getByText("Performance")).toBeInTheDocument();
    // Circular score gauge renders the numeric score.
    expect(screen.getByText("38")).toBeInTheDocument();
    // A finding chip with its title + file:line.
    expect(screen.getByText("Missing auth check")).toBeInTheDocument();
    expect(screen.getByText("src/api.ts:12")).toBeInTheDocument();
  });

  it("announces the live status of a running agent via an aria-live region (AC-37 a11y)", () => {
    renderColumns(RUN);
    const running = screen.getByText("Running");
    // The status sits inside a polite live region so SPA updates are announced.
    expect(running.closest("[aria-live='polite']")).not.toBeNull();
    // The still-running run's SSE stream is subscribed.
    expect(useRunEvents).toHaveBeenCalledWith(["run-perf"]);
  });

  it("shows the zero-findings empty state for a column with no findings (AC-37)", () => {
    renderColumns(RUN);
    expect(screen.getByText("No findings.")).toBeInTheDocument();
  });

  it("opens the run trace for a column when 'View trace' is clicked (AC-28/AC-18)", () => {
    const onOpenTrace = renderColumns(RUN);
    fireEvent.click(screen.getAllByText("View trace")[0]!);
    expect(onOpenTrace).toHaveBeenCalledTimes(1);
    expect(onOpenTrace.mock.calls[0]![0].run_id).toBe("run-sec");
  });
});
