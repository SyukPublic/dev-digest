import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, CiInstallation, CiRunSummary } from "@devdigest/shared";
import ciMessages from "../../../../../../../../messages/en/ci.json";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import commonMessages from "../../../../../../../../messages/en/common.json";
import { ToastProvider } from "@/lib/toast";

// Shared spy + mutable data the mocked hooks read at call time (EvalsTab pattern).
const updateMutate = vi.fn();
let installations: CiInstallation[] = [];
let runs: CiRunSummary[] = [];

vi.mock("@/lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: updateMutate, isPending: false, isSuccess: false, data: undefined }),
}));
vi.mock("@/lib/hooks/ci", () => ({
  useCiInstallations: () => ({ data: installations }),
  useAgentCiRuns: () => ({ data: runs }),
  useExportCi: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { CiTab } from "./CiTab";

afterEach(() => {
  installations = [];
  runs = [];
  updateMutate.mockClear();
  cleanup();
});

const AGENT = {
  id: "ag1",
  name: "Security Reviewer",
  provider: "openai",
  model: "gpt-4.1",
  ci_fail_on: "critical",
} as unknown as Agent;

function mkInstallation(over: Partial<CiInstallation>): CiInstallation {
  return { id: "i1", agent_id: "ag1", repo: "acme/api", target_type: "gha", installed_at: new Date().toISOString(), ...over };
}

function mkRun(over: Partial<CiRunSummary>): CiRunSummary {
  return {
    run_id: "r1", agent_id: "ag1", agent_name: "Security Reviewer", provider: "openai", model: "gpt-4.1",
    status: "done", error: null, duration_ms: 1200, tokens_in: 100, tokens_out: 50, cost_usd: 0.01,
    findings_count: 2, grounding: null, ran_at: new Date().toISOString(), score: 80, blockers: 0,
    source: "ci", repo: "acme/api", pr_number: 42, github_url: "https://github.com/acme/api/actions/runs/1",
    ci_installation_id: "i1", ...over,
  };
}

function renderTab(agent: Agent = AGENT) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: ciMessages, agents: agentsMessages, common: commonMessages }}>
      <ToastProvider>
        <CiTab agent={agent} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("CiTab (AC-1, AC-23, AC-29, AC-30, AC-31, AC-32)", () => {
  it("renders the header actions + Fail-CI-on control (test_ci_tab_renders / test_ci_tab_header)", () => {
    renderTab();
    expect(screen.getByRole("button", { name: "Update CI config" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Add to CI" })).toBeInTheDocument();
    // Fail-CI-on segmented control exposes all four values (agents namespace labels).
    expect(screen.getByRole("button", { name: "Never block — comment only" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Block on any finding" })).toBeInTheDocument();
  });

  it("shows the active-in-N-repos pill + per-repo installation rows (test_ci_tab_installations)", () => {
    installations = [mkInstallation({ id: "i1", repo: "acme/api" }), mkInstallation({ id: "i2", repo: "acme/web" })];
    runs = [mkRun({ ci_installation_id: "i1", findings_count: 0 })];
    renderTab();

    expect(screen.getByText("Active in 2 repos")).toBeInTheDocument();
    expect(screen.getByText("acme/api")).toBeInTheDocument();
    expect(screen.getByText("acme/web")).toBeInTheDocument();
    // "GitHub Actions" target badge on every installation row.
    expect(screen.getAllByText("GitHub Actions")).toHaveLength(2);
    // Latest run for i1 had zero findings → "No findings" status badge (shown on
    // the installation row and again in the run-history row for the same run).
    expect(screen.getAllByText("No findings").length).toBeGreaterThan(0);
    // Dashed add-repository row (reuses the common namespace label).
    expect(screen.getByRole("button", { name: /Add repository/ })).toBeInTheDocument();
  });

  it("renders CI run history, and an empty message when there are none (test_ci_tab_history)", () => {
    runs = [mkRun({ run_id: "r1", agent_name: "Security Reviewer", github_url: "https://gh/actions/1" })];
    const { unmount } = renderTab();
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Trace" })).toHaveAttribute("href", "https://gh/actions/1");
    unmount();

    runs = [];
    renderTab();
    expect(
      screen.getByText("Once you export an agent to CI, every automated review shows up here."),
    ).toBeInTheDocument();
  });

  it("writes the SAME ci_fail_on field the Config tab writes (test_ci_fail_on_both_tabs / test_ci_tab_failon)", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Block on any finding" }));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0]![0]).toEqual({ id: "ag1", patch: { ci_fail_on: "any" } });
  });
});
