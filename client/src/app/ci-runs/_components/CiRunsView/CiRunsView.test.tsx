import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, fireEvent, cleanup, within, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { CiRunSummary } from "@devdigest/shared";
import ciMessages from "../../../../../messages/en/ci.json";
import { CiRunsView } from "./CiRunsView";

// ---- Mocks ---------------------------------------------------------------
const mutate = vi.fn();
let ingestState = { mutate, isPending: false };
let ciRunsState: {
  data: CiRunSummary[] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
};

vi.mock("@/lib/hooks/ci-runs", () => ({
  useCiRuns: () => ciRunsState,
  useIngestCiRuns: () => ingestState,
}));

// Render children plainly — AppShell wiring has its own tests.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// ---- Fixtures ------------------------------------------------------------
function makeRun(over: Partial<CiRunSummary> = {}): CiRunSummary {
  return {
    run_id: "r1",
    agent_id: "a1",
    agent_name: "Reviewer A",
    provider: "openrouter",
    model: "gpt-x",
    status: "done",
    error: null,
    duration_ms: 7420,
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: 0.012,
    findings_count: 3,
    grounding: null,
    ran_at: "2026-07-14T10:00:00.000Z",
    score: 88,
    blockers: 1,
    source: "ci",
    repo: "acme/api",
    pr_number: 12,
    github_url: "https://github.com/acme/api/actions/runs/999",
    ci_installation_id: "inst1",
    ...over,
  };
}

const RUNS: CiRunSummary[] = [
  makeRun(),
  makeRun({
    run_id: "r2",
    agent_name: "Reviewer B",
    repo: "acme/web",
    pr_number: 34,
    status: "failed",
    findings_count: 0,
    blockers: 0,
    cost_usd: null,
    duration_ms: 74_210,
    github_url: "https://github.com/acme/web/actions/runs/1000",
  }),
];

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>
      <CiRunsView />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  mutate.mockClear();
  ingestState = { mutate, isPending: false };
  ciRunsState = { data: RUNS, isLoading: false, isError: false, refetch: vi.fn() };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CiRunsView", () => {
  // test_ci_runs_page + test_ci_runs_row
  it("renders the header, table columns and one row per CI run", () => {
    renderView();

    expect(screen.getByRole("heading", { name: "CI Runs" })).toBeInTheDocument();
    expect(screen.getByText("Agent reviews executed inside CI · not local runs")).toBeInTheDocument();

    // Scope row assertions to the table (filter <option>s reuse the same labels).
    const table = within(screen.getByRole("table"));

    // Column headers
    for (const h of ["Timestamp", "Pull request", "Agent", "Source", "Duration", "Findings", "Cost", "Status", "Trace"]) {
      expect(table.getByRole("columnheader", { name: h })).toBeInTheDocument();
    }

    // Both agents render; source cell is "GitHub Actions" (one per row)
    expect(table.getByText("Reviewer A")).toBeInTheDocument();
    expect(table.getByText("Reviewer B")).toBeInTheDocument();
    expect(table.getAllByText("GitHub Actions")).toHaveLength(2);

    // Row 1: PR link → the PR page; Trace link → the Actions run
    const prLink = table.getByRole("link", { name: "#12" });
    expect(prLink).toHaveAttribute("href", "https://github.com/acme/api/pull/12");
    const traceLinks = table.getAllByRole("link", { name: "Trace" });
    expect(traceLinks[0]).toHaveAttribute("href", "https://github.com/acme/api/actions/runs/999");

    // Status: findings → Succeeded; crashed run → Failed
    expect(table.getByText("Succeeded")).toBeInTheDocument();
    expect(table.getByText("Failed")).toBeInTheDocument();
    // Duration formatted (sub-minute vs multi-minute branches)
    expect(table.getByText("7.4s")).toBeInTheDocument();
    expect(table.getByText("1m 14s")).toBeInTheDocument();
  });

  // test_ci_runs_row (AC-34) — the Findings cell derives a severity split from
  // findings_count/blockers (CiRunSummary has no per-severity breakdown) and
  // renders "—" when there are no findings.
  it("renders derived severity-split finding counts, and '—' for a run with no findings", () => {
    renderView();
    const rows = screen.getAllByRole("row");
    // rows[0] is the header row; rows[1]/rows[2] are the two CI-run rows.
    const row1Cells = within(rows[1]!).getAllByRole("cell");
    const row2Cells = within(rows[2]!).getAllByRole("cell");
    const findingsCol = 5; // Timestamp, PR, Agent, Source, Duration, Findings, ...

    // Row 1: findings_count=3, blockers=1 → CRITICAL=1, WARNING=2 badges (both
    // counts rendered, never color-alone — SeverityCountBadges pairs icon+number).
    const row1Findings = within(row1Cells[findingsCol]!);
    expect(row1Findings.getByText("1")).toBeInTheDocument();
    expect(row1Findings.getByText("2")).toBeInTheDocument();

    // Row 2: findings_count=0 → no severity badges, just the muted dash.
    expect(within(row2Cells[findingsCol]!).getByText("—")).toBeInTheDocument();
  });

  // test_ci_runs_empty
  it("shows the empty state when there are no CI runs", () => {
    ciRunsState = { ...ciRunsState, data: [] };
    renderView();
    expect(screen.getByText("No CI runs yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  // test_ci_runs_filters
  it("filters the rows client-side by agent", () => {
    renderView();
    expect(within(screen.getByRole("table")).getByText("Reviewer A")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("Reviewer B")).toBeInTheDocument();

    // The agent <select> is the one carrying an "All agents" option.
    const agentSelect = screen
      .getAllByRole("combobox")
      .find((el) => within(el).queryByRole("option", { name: "All agents" }));
    expect(agentSelect).toBeDefined();
    fireEvent.change(agentSelect as HTMLSelectElement, { target: { value: "Reviewer B" } });

    // Only Reviewer B's row remains (the agent still exists as a filter option).
    const table = within(screen.getByRole("table"));
    expect(table.queryByText("Reviewer A")).not.toBeInTheDocument();
    expect(table.getByText("Reviewer B")).toBeInTheDocument();
  });

  // test_refresh
  it("re-runs the ingest when Refresh is clicked and shows the refreshing state", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(mutate).toHaveBeenCalledTimes(1);

    // While pending the button reads "Refreshing…" and is disabled.
    ingestState = { mutate, isPending: true };
    cleanup();
    renderView();
    const btn = screen.getByRole("button", { name: /refreshing/i });
    expect(btn).toBeDisabled();
  });

  // test_auto_refresh
  it("re-runs the ingest every 30s while auto-refresh is on", () => {
    vi.useFakeTimers();
    renderView();

    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    // The "auto-refresh on" indicator appears.
    expect(screen.getByText("auto-refresh on")).toBeInTheDocument();

    // No ingest yet — only the interval drives it.
    expect(mutate).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(30_000));
    expect(mutate).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(30_000));
    expect(mutate).toHaveBeenCalledTimes(2);
  });
});
