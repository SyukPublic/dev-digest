import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { MultiAgentRun } from "@devdigest/shared";
import runsMessages from "../../../../../messages/en/runs.json";
import MultiAgentReviewPage from "./page";

let params = new URLSearchParams("pr=pr1");
const useMultiAgentRun = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
  useSearchParams: () => params,
}));
vi.mock("@/lib/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/run-trace", () => ({ default: () => <div>DRAWER</div> }));
vi.mock("@/lib/repo-context", () => ({ useActiveRepo: () => ({ activeRepo: { full_name: "o/r" } }) }));
vi.mock("@/lib/hooks/core", () => ({ usePulls: () => ({ data: [{ id: "pr1", number: 482, title: "Add rate limiting" }] }) }));
vi.mock("@/lib/hooks/reviews", () => ({ usePrReviews: () => ({ data: [] }) }));
vi.mock("@/lib/hooks/multi-agent", () => ({ useMultiAgentRun: () => useMultiAgentRun() }));

// The child views are asserted in their own tests — here they are markers so the
// page test only covers the mode/view orchestration.
vi.mock("./_components/ConfigureRun", () => ({
  ConfigureRun: ({ hasResults, onViewResults }: { hasResults?: boolean; onViewResults?: () => void }) => (
    <div>
      CONFIGURE
      {hasResults && (
        <button type="button" onClick={onViewResults}>
          View results
        </button>
      )}
    </div>
  ),
}));
vi.mock("./_components/ColumnsView", () => ({ ColumnsView: () => <div>COLUMNS</div> }));
vi.mock("./_components/TabsView", () => ({ TabsView: () => <div>TABS</div> }));
vi.mock("./_components/ConflictsBlock", () => ({ ConflictsBlock: () => <div>CONFLICTS</div> }));

const RUN: MultiAgentRun = {
  id: "mr1", pr_id: "pr1", pr_number: 482, ran_at: "2026-07-14T00:00:00Z",
  agent_count: 3, total_duration_ms: 12000, total_cost_usd: 0.07, columns: [], conflicts: [],
};

beforeEach(() => {
  params = new URLSearchParams("pr=pr1");
});
afterEach(cleanup);

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: runsMessages }}>
      <MultiAgentReviewPage />
    </NextIntlClientProvider>,
  );
}

describe("MultiAgentReviewPage — mode + view orchestration", () => {
  it("opens in Configure run mode when the PR has no multi-run yet (AC-2)", () => {
    useMultiAgentRun.mockReturnValue({ data: undefined, isLoading: false });
    renderPage();
    expect(screen.getByText("CONFIGURE")).toBeInTheDocument();
    expect(screen.queryByText("COLUMNS")).not.toBeInTheDocument();
  });

  it("shows the loading skeleton (not Configure) while the run for ?pr is still loading (AC-12)", () => {
    // Landing from the PR-header launch: ?pr=pr1 is set but the run query has no
    // cached data yet, so it starts loading → skeleton, never a flash of Configure.
    useMultiAgentRun.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = renderPage();

    expect(container.querySelector(".skeleton")).toBeInTheDocument();
    expect(screen.queryByText("CONFIGURE")).not.toBeInTheDocument();
    expect(screen.queryByText("COLUMNS")).not.toBeInTheDocument();
  });

  it("resolves to Results once the run for ?pr loads (not Configure) (AC-13)", () => {
    // The loaded run for ?pr=pr1 lands the page directly on Results.
    useMultiAgentRun.mockReturnValue({ data: RUN, isLoading: false });
    renderPage();

    expect(screen.getByText("COLUMNS")).toBeInTheDocument();
    expect(screen.getByText("CONFLICTS")).toBeInTheDocument();
    expect(screen.queryByText("CONFIGURE")).not.toBeInTheDocument();
  });

  it("shows Results (Columns default + Conflicts) and toggles to Tabs (AC-18)", () => {
    useMultiAgentRun.mockReturnValue({ data: RUN, isLoading: false });
    renderPage();

    // Columns is the default results view; the conflicts block sits below it.
    expect(screen.getByText("COLUMNS")).toBeInTheDocument();
    expect(screen.getByText("CONFLICTS")).toBeInTheDocument();
    expect(screen.queryByText("TABS")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "tabs" }));
    expect(screen.getByText("TABS")).toBeInTheDocument();
    expect(screen.queryByText("COLUMNS")).not.toBeInTheDocument();
    // Conflicts render under both views.
    expect(screen.getByText("CONFLICTS")).toBeInTheDocument();
  });

  it("returns to Configure run from Results via the 'Configure run' control (AC-3)", () => {
    useMultiAgentRun.mockReturnValue({ data: RUN, isLoading: false });
    renderPage();
    expect(screen.getByText("COLUMNS")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Configure run" }));
    expect(screen.getByText("CONFIGURE")).toBeInTheDocument();
    expect(screen.queryByText("COLUMNS")).not.toBeInTheDocument();
  });

  it("jumps back to Results from Configure via 'View results' — a mode flip, no launch (test_page_view_results_switches_to_results, AC-16)", () => {
    // A PR with a completed run → open Configure via the Results header control…
    useMultiAgentRun.mockReturnValue({ data: RUN, isLoading: false });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Configure run" }));
    expect(screen.getByText("CONFIGURE")).toBeInTheDocument();

    // …Configure now offers the reciprocal "View results" (hasResults = run && !loading).
    const viewBtn = screen.getByRole("button", { name: "View results" });

    // Activating it clears the override → inResults flips back to Results (no relaunch).
    fireEvent.click(viewBtn);
    expect(screen.getByText("COLUMNS")).toBeInTheDocument();
    expect(screen.getByText("CONFLICTS")).toBeInTheDocument();
    expect(screen.queryByText("CONFIGURE")).not.toBeInTheDocument();
  });

  it("hides 'View results' in Configure when the PR has no run (guards AC-16 gating)", () => {
    // No run for ?pr → Configure mode with hasResults=false → no reciprocal control.
    useMultiAgentRun.mockReturnValue({ data: undefined, isLoading: false });
    renderPage();

    expect(screen.getByText("CONFIGURE")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View results" })).not.toBeInTheDocument();
  });
});
