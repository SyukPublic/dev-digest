import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalSkillsWorkspaceDashboard } from "@devdigest/shared";
import evalMessages from "../../../../../messages/en/eval.json";
import { AllSkillsView } from "./AllSkillsView";

const runAll = { mutate: vi.fn(), isPending: false };
let data: EvalSkillsWorkspaceDashboard | undefined;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks/eval", () => ({
  useWorkspaceSkillEvalDashboard: () => ({ data, isLoading: false }),
  useRunAllSkills: () => runAll,
  // pure helper — mirror the real predicate (module is fully mocked)
  anyRunning: (runs: Array<{ status: string }> | undefined) =>
    (runs ?? []).some((r) => r.status === "running"),
}));

afterEach(cleanup);

function skillRun(over: Partial<EvalSkillsWorkspaceDashboard["recent_runs"][number]> = {}) {
  return {
    id: "sr1",
    workspace_id: "w",
    skill_id: "k1",
    skill_name: "No-secrets",
    skill_version: 4,
    host_agent_id: "a1",
    host_agent_name: "Security",
    host_agent_version: 7,
    status: "done" as const,
    recall: 0.8,
    precision: 0.75,
    citation_accuracy: 0.9,
    passed: 12,
    total: 15,
    cost_usd: 0.1,
    duration_ms: 2000,
    ran_at: new Date().toISOString(),
    ...over,
  };
}

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <AllSkillsView />
    </NextIntlClientProvider>,
  );
}

describe("AllSkillsView (AC-24/AC-14)", () => {
  it("lists skills with delta metrics + a recent-runs table; never-run skills show '—'", () => {
    data = {
      skills: [
        {
          skill_id: "k1",
          skill_name: "No-secrets",
          enabled: true,
          cases_total: 3,
          current: { recall: 0.8, precision: 0.75, citation_accuracy: 0.9 },
          sparklines: { recall: [0.7, 0.8], precision: [0.7, 0.75], citation_accuracy: [0.85, 0.9] },
          last_run: skillRun(),
        },
        {
          skill_id: "k2",
          skill_name: "Perf-tips",
          enabled: false,
          cases_total: 0,
          current: { recall: null, precision: null, citation_accuracy: null },
          sparklines: { recall: [], precision: [], citation_accuracy: [] },
          last_run: null,
        },
      ],
      recent_runs: [skillRun()],
    };
    renderView();
    // "No-secrets" appears in the skill row and the recent-runs table
    expect(screen.getAllByText("No-secrets").length).toBeGreaterThan(0);
    expect(screen.getByText("Perf-tips")).toBeInTheDocument();
    // host label surfaces in the row badge + the recent-runs table
    expect(screen.getAllByText("Host Security · v7").length).toBeGreaterThan(0);
    // never-run skill → "Never run" + "—" metrics
    expect(screen.getByText("Never run")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    // recent-runs table shows the run's pass tally
    expect(screen.getByText("12/15")).toBeInTheDocument();
    // short CITATION label in the skill rows (one per skill)
    expect(screen.getAllByText("CITATION").length).toBe(2);
    // all recent runs terminal → the Run-all button is idle
    expect(screen.getByText("Run all skills").closest("button")).not.toBeDisabled();
    // enabled skill row full-opacity; disabled skill row dimmed
    const noSecretsRow = screen
      .getAllByText("No-secrets")
      .map((el) => el.closest("button"))
      .find((el) => el != null)!;
    expect(noSecretsRow).toHaveStyle({ opacity: "1" });
    expect(screen.getByText("Perf-tips").closest("button")).toHaveStyle({ opacity: "0.6" });
  });

  it("triggers run-all and shows the empty state when there are no skills", () => {
    data = { skills: [], recent_runs: [] };
    renderView();
    expect(screen.getByText(/No skills yet/)).toBeInTheDocument();
    screen.getByText("Run all skills").click();
    expect(runAll.mutate).toHaveBeenCalled();
  });

  it("keeps Run-all in the loading state while any skill suite is running", () => {
    data = {
      skills: [],
      recent_runs: [skillRun({ id: "sr9", status: "running", recall: null, precision: null, citation_accuracy: null, passed: 0, cost_usd: null })],
    };
    renderView();
    // fire-and-forget run-all → busy binds to the running suite, not the mutation
    expect(screen.getByText("Run all skills").closest("button")).toBeDisabled();
  });
});
