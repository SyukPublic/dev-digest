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
const deleteMutate = vi.fn();
let installations: CiInstallation[] = [];
let runs: CiRunSummary[] = [];

vi.mock("@/lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: updateMutate, isPending: false, isSuccess: false, data: undefined }),
}));
vi.mock("@/lib/hooks/ci", () => ({
  useCiInstallations: () => ({ data: installations }),
  useAgentCiRuns: () => ({ data: runs }),
  useExportCi: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteCiInstallation: () => ({ mutate: deleteMutate, isPending: false }),
}));

import { CiTab } from "./CiTab";

afterEach(() => {
  installations = [];
  runs = [];
  updateMutate.mockClear();
  deleteMutate.mockClear();
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
    suggestions: null, source: "ci", repo: "acme/api", pr_number: 42,
    github_url: "https://github.com/acme/api/actions/runs/1",
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
  it("renders the 'CI deployment' heading with the inline status pill + header actions (test_ci_tab_header)", () => {
    installations = [mkInstallation({ id: "i1", repo: "acme/api" }), mkInstallation({ id: "i2", repo: "acme/web" })];
    renderTab();
    // AC-46: the heading reads "CI deployment"…
    expect(screen.getByRole("heading", { name: "CI deployment" })).toBeInTheDocument();
    // …with the "Active in {n} repos" pill inline (from the `ci` namespace, ICU plural)…
    expect(screen.getByText("Active in 2 repos")).toBeInTheDocument();
    // …and the header actions on the right of the same row.
    expect(screen.getByRole("button", { name: "Update CI config" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Add to CI" })).toBeInTheDocument();
  });

  it("renders the singular pill form for a single repo (test_ci_tab_header)", () => {
    installations = [mkInstallation({ id: "i1", repo: "acme/api" })];
    renderTab();
    expect(screen.getByText("Active in 1 repo")).toBeInTheDocument();
  });

  it("renders the Fail-CI-on gate with the `ci`-namespace label + hint and all four verbose options, stacked (test_ci_tab_failon / test_ci_tab_failon_stacked)", () => {
    renderTab();
    // AC-47/49: label + hint come from the `ci` namespace, independent of the Config tab.
    const label = screen.getByText("Fail CI on");
    const hint = screen.getByText(/Exit non-zero when a finding at or above this severity lands/);
    expect(label).toBeInTheDocument();
    expect(hint).toBeInTheDocument();
    // AC-48: all FOUR verbose options remain (agents namespace labels).
    expect(screen.getByRole("button", { name: "Never block — comment only" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Block on critical (recommended)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Block on warning or critical" })).toBeInTheDocument();
    const anyBtn = screen.getByRole("button", { name: "Block on any finding" });
    expect(anyBtn).toBeInTheDocument();
    // AC-50: reading order is label → description → control (DOM order proves the stack).
    const pos = (a: Node, b: Node) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(pos(label, hint)).toBeTruthy();
    expect(pos(hint, anyBtn)).toBeTruthy();
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

  it("exposes a Remove-from-CI action per row that opens a confirm dialog naming repo + agent, and confirms the uninstall (test_remove_from_ci_confirm / AC-75/AC-76)", () => {
    installations = [mkInstallation({ id: "i1", repo: "acme/api" }), mkInstallation({ id: "i2", repo: "acme/web" })];
    renderTab();

    // Each installation row exposes an accessible, keyboard-operable remove action
    // naming the repo + agent (AC-75).
    const removeApi = screen.getByRole("button", { name: "Remove Security Reviewer from acme/api" });
    const removeWeb = screen.getByRole("button", { name: "Remove Security Reviewer from acme/web" });
    expect(removeApi).toBeInTheDocument();
    expect(removeWeb).toBeInTheDocument();

    // Opening it shows a confirmation dialog naming the repo + agent before removal.
    fireEvent.click(removeApi);
    const dialog = screen.getByRole("dialog");
    expect(screen.getByText("Remove from CI?")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Security Reviewer");
    expect(dialog).toHaveTextContent("acme/api");
    // The last-agent teardown caveat is surfaced.
    expect(dialog).toHaveTextContent(/last agent/i);

    // Confirming triggers the uninstall mutation for THAT installation only.
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(deleteMutate).toHaveBeenCalledTimes(1);
    expect(deleteMutate.mock.calls[0]![0]).toBe("i1");
  });

  it("cancelling the Remove dialog does NOT uninstall (test_remove_from_ci_confirm)", () => {
    installations = [mkInstallation({ id: "i1", repo: "acme/api" })];
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Remove Security Reviewer from acme/api" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(deleteMutate).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("writes the SAME ci_fail_on field the Config tab writes (test_ci_fail_on_both_tabs / test_ci_tab_failon)", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Block on any finding" }));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0]![0]).toEqual({ id: "ag1", patch: { ci_fail_on: "any" } });
  });
});

describe("ci.json keys (test_ci_json_keys)", () => {
  it("defines the migrated CI-tab keys in the `ci` namespace (AC-46, AC-47, AC-49)", () => {
    const t = ciMessages.ciTab as Record<string, unknown>;
    expect(t.heading).toBe("CI deployment");
    expect(t.runHistory).toBe("CI run history");
    // ICU plural form (renders "Active in 1 repo" / "Active in 2 repos").
    expect(typeof t.activeInRepos).toBe("string");
    expect(t.activeInRepos).toContain("plural");
    const failOn = t.failOn as Record<string, unknown>;
    expect(failOn.label).toBe("Fail CI on");
    expect(typeof failOn.hint).toBe("string");
    expect((failOn.hint as string).length).toBeGreaterThan(0);
  });
});
