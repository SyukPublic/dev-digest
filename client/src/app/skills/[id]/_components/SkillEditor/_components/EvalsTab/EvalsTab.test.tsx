/* test_skill_evals_tab (T40, T41) — the SkillEditor "Evals" tab: delta-metric
   tiles (null → "—"), the case list with status + expectation chip, the inline
   HostAgentPicker + "Run on evals" (disabled until a host resolves), per-row
   skill-scoped run spinner, the per-case DeltaFindings expand, and opening the
   owner=skill CaseEditor. Client convention: fireEvent (no user-event), mock the
   data hooks + next/navigation, render under NextIntlClientProvider (messages by
   RELATIVE path) + ToastProvider. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCaseListItem, EvalSkillHostCandidates, EvalSkillSuiteDetail } from "@devdigest/shared";
import evalMessages from "../../../../../../../../messages/en/eval.json";
import { ToastProvider } from "@/lib/toast";

const push = vi.fn();
const runAll = { mutate: vi.fn(), isPending: false };
const runCase = { mutate: vi.fn(), isPending: false };
const del = { mutate: vi.fn() };

let dashData: unknown;
let casesData: EvalCaseListItem[];
let hostsData: EvalSkillHostCandidates | undefined;
let suiteData: EvalSkillSuiteDetail | undefined;
let runningIds: string[] = [];

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/lib/hooks/eval", () => ({
  anyRunning: (runs?: Array<{ status: string }>) => (runs ?? []).some((r) => r.status === "running"),
  useSkillEvalDashboard: () => ({ data: dashData }),
  useSkillEvalCases: () => ({ data: casesData, isLoading: false }),
  useSkillEvalHosts: () => ({ data: hostsData }),
  useSkillEvalSuite: () => ({ data: suiteData }),
  useRunSkillEvals: () => runAll,
  useRunSkillCase: () => runCase,
  useRunningSkillCaseIds: () => runningIds,
  useDeleteEvalCase: () => del,
  // Present for the CaseEditor (only mounted when a case is opened).
  useEvalCase: () => ({ data: undefined, isLoading: false }),
  useCreateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRunCase: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

import { EvalsTab } from "./EvalsTab";

const SKILL = { id: "sk1", name: "Security Rubric", version: 5 } as never;

const ONE_ENABLED_HOST: EvalSkillHostCandidates = {
  default_host_id: "a1",
  candidates: [{ id: "a1", name: "Sec Reviewer", version: 2, enabled: true }],
};

afterEach(() => {
  runningIds = [];
  hostsData = ONE_ENABLED_HOST;
  suiteData = undefined;
  vi.clearAllMocks();
  cleanup();
});

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <ToastProvider>
        <EvalsTab skill={SKILL} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("SkillEditor EvalsTab (AC-1, AC-14, AC-2, AC-30)", () => {
  it("renders delta tiles (null → '—'), the case list, host picker, and controls", () => {
    hostsData = ONE_ENABLED_HOST;
    dashData = {
      current: { recall: null, precision: 0.8, citation_accuracy: 0.9, traces_passed: 1, traces_total: 2, cost_usd: null },
    };
    casesData = [
      {
        id: "c1", name: "stripe-key-leak", expectation: "must_find", expected_count: 1,
        latest: { run_id: "r1", pass: true, recall: 1, precision: 1, citation_accuracy: 1, actual_count: 1, duration_ms: 1200, cost_usd: 0.02, ran_at: new Date().toISOString(), error: null },
      },
      { id: "c2", name: "clean-config", expectation: "must_not_flag", expected_count: 0, latest: null },
    ];
    renderTab();

    // metric tiles — null recall renders "—"
    expect(screen.getByText("RECALL")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();

    // controls: skill-specific "Run on evals" + "New eval case" + dashboard deep-link
    expect(screen.getByText("Run on evals")).toBeInTheDocument();
    expect(screen.getByText("New eval case")).toBeInTheDocument();
    expect(screen.getByText("View full dashboard →")).toBeInTheDocument();
    // the inline host picker
    expect(screen.getByLabelText("Host agent")).toBeInTheDocument();

    // case rows: names + statuses + expectation chips
    expect(screen.getByText("stripe-key-leak")).toBeInTheDocument();
    expect(screen.getByText("clean-config")).toBeInTheDocument();
    expect(screen.getByText("passed")).toBeInTheDocument();
    expect(screen.getByText("empty []")).toBeInTheDocument();
  });

  it("routes 'View full dashboard' to the skills tab deep-link", () => {
    dashData = { current: null };
    casesData = [];
    renderTab();
    fireEvent.click(screen.getByText("View full dashboard →"));
    expect(push).toHaveBeenCalledWith("/eval?tab=skills&skill=sk1");
  });

  it("runs the suite on the auto-resolved host when 'Run on evals' is clicked", () => {
    dashData = { current: null };
    casesData = [{ id: "c1", name: "x", expectation: "must_find", expected_count: 1, latest: null }];
    renderTab();
    // The HostAgentPicker auto-selects default_host_id (a1) via onChange, so Run
    // is enabled and fires the suite on that host.
    const runBtn = screen.getByRole("button", { name: "Run on evals" });
    expect(runBtn).not.toBeDisabled();
    fireEvent.click(runBtn);
    expect(runAll.mutate).toHaveBeenCalledWith("a1");
  });

  it("disables Run when no enabled host exists (skill needs a host)", () => {
    hostsData = { default_host_id: null, candidates: [{ id: "a1", name: "Sec", version: 1, enabled: false }] };
    dashData = { current: null };
    casesData = [{ id: "c1", name: "x", expectation: "must_find", expected_count: 1, latest: null }];
    renderTab();
    expect(screen.getByText("No enabled agent to host")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run on evals" })).toBeDisabled();
  });

  it("spins ONLY the case with an in-flight skill run; others stay runnable", () => {
    dashData = { current: null };
    casesData = [
      { id: "c1", name: "case-one", expectation: "must_find", expected_count: 1, latest: null },
      { id: "c2", name: "case-two", expectation: "must_find", expected_count: 1, latest: null },
    ];
    runningIds = ["c1"];
    renderTab();
    const runButtons = screen.getAllByRole("button", { name: "Run" });
    expect(runButtons).toHaveLength(2);
    expect(runButtons[0]!.querySelector(".dd-spin")).not.toBeNull();
    expect(runButtons[0]!).toBeDisabled();
    expect(runButtons[1]!.querySelector(".dd-spin")).toBeNull();
    expect(runButtons[1]!).not.toBeDisabled();
  });

  it("runs a single skill case against the resolved host", () => {
    dashData = { current: null };
    casesData = [{ id: "c1", name: "case-one", expectation: "must_find", expected_count: 1, latest: null }];
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(runCase.mutate).toHaveBeenCalledWith({ caseId: "c1", hostAgentId: "a1" });
  });

  it("expands a case's latest result to show the DELTA findings the skill added", () => {
    dashData = {
      current: null,
      recent_runs: [{ id: "s1", status: "done", skill_version: 5, host_agent_version: 2, ran_at: new Date().toISOString() }],
    };
    casesData = [
      {
        id: "c1", name: "stripe-key-leak", expectation: "must_find", expected_count: 1,
        latest: { run_id: "r1", pass: true, recall: 1, precision: 1, citation_accuracy: 1, actual_count: 1, duration_ms: 1, cost_usd: null, ran_at: new Date().toISOString(), error: null },
      },
    ];
    suiteData = {
      suite: { id: "s1" } as never,
      runs: [
        {
          id: "r1", case_id: "c1", case_name: "stripe-key-leak", ran_at: new Date().toISOString(),
          actual_output: {
            findings: [
              { file: "src/config.ts", start_line: 10, end_line: 12, severity: "CRITICAL", category: "security", title: "Hardcoded key", classification: "caught" },
            ],
          },
          pass: true, recall: 1, precision: 1, citation_accuracy: 1, duration_ms: 1, cost_usd: null, suite_run_id: null, error: null,
        },
      ],
    };
    renderTab();

    // toggle the delta panel open (its accessible name is the delta heading copy)
    fireEvent.click(screen.getByRole("button", { name: "Findings added by this skill" }));
    expect(screen.getByText("Hardcoded key")).toBeInTheDocument();
    expect(screen.getByText("caught")).toBeInTheDocument();
  });

  it("opens the owner=skill CaseEditor from 'New eval case'", () => {
    dashData = { current: null };
    casesData = [];
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "New eval case" }));
    // CaseEditor subtitle carries the skill name as the owner (owner-generic).
    expect(screen.getByText(/simulate a PR/)).toBeInTheDocument();
  });

  it("shows the empty state when the skill has no cases", () => {
    dashData = { current: null };
    casesData = [];
    renderTab();
    expect(screen.getByText(/No eval cases yet/)).toBeInTheDocument();
  });
});
