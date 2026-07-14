import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { MultiAgentRun, ReviewRecord } from "@devdigest/shared";
import runsMessages from "../../../../../../../messages/en/runs.json";
import { ToastProvider } from "@/lib/toast";
import { TabsView } from "./TabsView";

const usePrReviews = vi.fn();
const actionMutate = vi.fn();
const evalMutate = vi.fn();

vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: () => usePrReviews(),
  useFindingAction: () => ({ mutate: actionMutate, isPending: false }),
}));
vi.mock("@/lib/hooks/eval", () => ({
  useEvalCaseDraftFromFinding: () => ({ mutate: evalMutate, isPending: false }),
}));
vi.mock("@/components/eval/CaseEditor", () => ({
  CaseEditor: ({ initialDraft }: { initialDraft?: { agent_name: string } }) => (
    <div>CASE_EDITOR:{initialDraft?.agent_name}</div>
  ),
}));

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
    { run_id: "run-sec", agent_id: "a1", agent_name: "Security", provider: "openai", model: "m", status: "done", verdict: "request_changes", score: 38, summary: "Security issues", duration_ms: 12000, cost_usd: 0.05, findings: [] },
    { run_id: "run-perf", agent_id: "a2", agent_name: "Performance", provider: "openai", model: "m", status: "done", verdict: "comment", score: 64, summary: "Perf notes", duration_ms: 8000, cost_usd: 0.02, findings: [] },
  ],
};

const REVIEWS: ReviewRecord[] = [
  {
    id: "rv-sec", pr_id: "pr1", agent_id: "a1", run_id: "run-sec", agent_name: "Security",
    kind: "review", verdict: "request_changes", summary: "s", score: 38, model: "m", created_at: "2026-07-14T00:00:00Z",
    findings: [
      {
        id: "f-sec", severity: "CRITICAL", category: "security", title: "Missing auth check",
        file: "src/api.ts", start_line: 12, end_line: 12, rationale: "Endpoint lacks authorization.",
        suggestion: "Add an auth guard.", confidence: 0.98, kind: "lethal_trifecta",
        trifecta_components: ["private_data_access", "untrusted_input", "exfil_path"], evidence: null,
        review_id: "rv-sec", accepted_at: "2026-07-14T00:00:00Z", dismissed_at: null,
      },
    ],
  },
  {
    id: "rv-perf", pr_id: "pr1", agent_id: "a2", run_id: "run-perf", agent_name: "Performance",
    kind: "review", verdict: "comment", summary: "p", score: 64, model: "m", created_at: "2026-07-14T00:00:00Z",
    findings: [
      {
        id: "f-perf", severity: "WARNING", category: "perf", title: "N+1 query in loop",
        file: "src/list.ts", start_line: 30, end_line: 34, rationale: "Query runs per row.",
        suggestion: null, confidence: 0.7, kind: "finding", trifecta_components: null, evidence: null,
        review_id: "rv-perf", accepted_at: null, dismissed_at: null,
      },
    ],
  },
];

beforeEach(() => {
  usePrReviews.mockReturnValue({ data: REVIEWS });
  actionMutate.mockReset();
  evalMutate.mockReset();
});
afterEach(cleanup);

function renderTabs(onOpenTrace = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ runs: runsMessages }}>
      <ToastProvider>
        <TabsView run={RUN} prId="pr1" onOpenTrace={onOpenTrace} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
  return onOpenTrace;
}

describe("TabsView (test_tabs_detail)", () => {
  it("shows the active agent's findings and switches on tab click", () => {
    renderTabs();
    // Default tab = first column (Security) → its full finding is listed.
    expect(screen.getByText("Missing auth check")).toBeInTheDocument();
    expect(screen.queryByText("N+1 query in loop")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Performance"));
    expect(screen.getByText("N+1 query in loop")).toBeInTheDocument();
    expect(screen.queryByText("Missing auth check")).not.toBeInTheDocument();
  });

  it("expands a finding to reveal confidence %, suggested fix, and the trifecta badge (AC-24/AC-26)", () => {
    renderTabs();
    fireEvent.click(screen.getByText("Missing auth check"));

    expect(screen.getByText(/98% conf/)).toBeInTheDocument();
    expect(screen.getByText("Suggested fix")).toBeInTheDocument();
    // lethal_trifecta renders the "ALL 3 PRESENT" venn badge.
    expect(screen.getByText(/ALL 3 PRESENT/)).toBeInTheDocument();
  });

  it("wires Accept/Dismiss/Learn/Turn-into-eval-case actions (AC-24/AC-25)", () => {
    renderTabs();
    fireEvent.click(screen.getByText("Missing auth check"));

    // Learn is a disabled stub (no Memory subsystem yet).
    expect(screen.getByRole("button", { name: "Learn" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(actionMutate).toHaveBeenCalledWith({ findingId: "f-sec", action: "accept", prId: "pr1" });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(actionMutate).toHaveBeenCalledWith({ findingId: "f-sec", action: "dismiss", prId: "pr1" });
  });

  it("bridges a finding into a new eval case via CaseEditor (create-on-save, AC-25)", () => {
    evalMutate.mockImplementation((_id, opts) =>
      opts?.onSuccess?.({ agent_id: "a1", agent_name: "Security" }),
    );
    renderTabs();
    fireEvent.click(screen.getByText("Missing auth check"));

    // Enabled because the finding is decided (accepted_at set).
    fireEvent.click(screen.getByRole("button", { name: "Turn into eval case" }));
    expect(evalMutate).toHaveBeenCalledWith("f-sec", expect.anything());
    expect(screen.getByText("CASE_EDITOR:Security")).toBeInTheDocument();
  });
});
