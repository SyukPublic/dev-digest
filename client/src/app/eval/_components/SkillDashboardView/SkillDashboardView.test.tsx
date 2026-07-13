import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalSkillDashboardWithStability } from "@devdigest/shared";
import evalMessages from "../../../../../messages/en/eval.json";
import { SkillDashboardView } from "./SkillDashboardView";

const runEval = { mutate: vi.fn(), isPending: false };
const startStability = { mutate: vi.fn(), isPending: false };
let dash: EvalSkillDashboardWithStability | undefined;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks/eval", () => ({
  useSkillEvalDashboard: () => ({ data: dash, isLoading: false }),
  useRunSkillEvals: () => runEval,
  useStartSkillStability: () => startStability,
  // pure helper — mirror the real predicate (module is fully mocked)
  anyRunning: (runs: Array<{ status: string }> | undefined) =>
    (runs ?? []).some((r) => r.status === "running"),
}));
// The host picker + compare modal have their own tests; stub them here. The
// picker auto-selects a host so the Run button is enabled (mirrors the real one).
vi.mock("@/components/eval/HostAgentPicker", () => ({
  HostAgentPicker: ({ value, onChange }: { value: string | null; onChange: (id: string) => void }) => {
    React.useEffect(() => {
      if (!value) onChange("h1");
    }, [value, onChange]);
    return <div>HOST_PICKER:{value ?? "none"}</div>;
  },
}));
vi.mock("@/components/eval/SkillCompareModal", () => ({
  SkillCompareModal: ({ a, b, onClose }: { a: string; b: string; onClose: () => void }) => (
    <div role="dialog">
      COMPARE:{a}:{b}
      <button onClick={onClose}>x</button>
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function suite(v: number, id = `s${v}`) {
  return {
    id,
    workspace_id: "w",
    skill_id: "k1",
    skill_name: "No-secrets",
    skill_version: v,
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
  };
}

function trendPoint(v: number, id = `s${v}`) {
  return {
    suite_run_id: id,
    ran_at: new Date().toISOString(),
    skill_version: v,
    host_agent_id: "a1",
    host_agent_version: 7,
    recall: 0.8,
    precision: 0.75,
    citation_accuracy: 0.9,
    pass_rate: 0.8,
    cost_usd: 0.1,
  };
}

/** A dashboard with the stability fields null/empty by default. */
function makeDash(
  over: Partial<EvalSkillDashboardWithStability> = {},
): EvalSkillDashboardWithStability {
  return {
    skill_id: "k1",
    skill_name: "No-secrets",
    cases_total: 3,
    current: { recall: 0.8, precision: 0.75, citation_accuracy: 0.9, traces_passed: 12, traces_total: 15, cost_usd: 0.1 },
    delta: { recall: 0, precision: -0.02, citation_accuracy: 0 },
    trend: [trendPoint(3, "s3"), trendPoint(4, "s4")],
    recent_runs: [suite(4), suite(3)],
    alert: null,
    stability: null,
    stability_group: null,
    case_stability: [],
    stability_alert: null,
    ...over,
  };
}

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <SkillDashboardView skillId="k1" />
    </NextIntlClientProvider>,
  );
}

describe("SkillDashboardView (AC-26/AC-27/AC-28)", () => {
  it("shows the alert banner + delta cards, and enables Compare only at 2 selected", () => {
    dash = makeDash({ alert: "Precision dipped 2pts on skill v4" });
    renderView();

    expect(screen.getByRole("alert")).toHaveTextContent("Precision dipped 2pts on skill v4");
    expect(screen.getByText("No-secrets")).toBeInTheDocument();
    expect(screen.getAllByText("v4").length).toBeGreaterThan(0);
    expect(screen.getByText("Run evals").closest("button")).not.toBeDisabled();

    const compareBtn = screen.getByText("Compare").closest("button")!;
    expect(compareBtn).toBeDisabled();

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!);
    expect(compareBtn).toBeDisabled();
    fireEvent.click(checkboxes[1]!);
    expect(compareBtn).not.toBeDisabled();

    fireEvent.click(compareBtn);
    expect(screen.getByRole("dialog")).toHaveTextContent("COMPARE:s4:s3");
  });

  it("shows no alert with fewer than two completed runs and renders null metrics as '—'", () => {
    dash = makeDash({
      cases_total: 1,
      current: { recall: null, precision: null, citation_accuracy: null, traces_passed: 0, traces_total: 0, cost_usd: null },
      delta: { recall: null, precision: null, citation_accuracy: null },
      trend: [trendPoint(4, "s4")],
      recent_runs: [suite(4)],
    });
    renderView();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("keeps the Run button in the loading state while a suite is running", () => {
    dash = makeDash({
      delta: { recall: null, precision: null, citation_accuracy: null },
      trend: [],
      recent_runs: [{ ...suite(5), status: "running" as const }, suite(4)],
    });
    renderView();
    expect(screen.getByText("Run evals").closest("button")).toBeDisabled();
  });
});

describe("SkillDashboardView — stability layer (AC-1/AC-4/AC-10)", () => {
  it("renders the repeat control + Run stability button; starting fires the mutation with n", () => {
    dash = makeDash();
    renderView();

    const repeat = screen.getByLabelText("Repeat") as HTMLSelectElement;
    expect(repeat).toBeInTheDocument();
    // Options span the min..max repeat range (2..5).
    expect(Array.from(repeat.options).map((o) => o.value)).toEqual(["2", "3", "4", "5"]);

    fireEvent.change(repeat, { target: { value: "4" } });
    const runStability = screen.getByText("Run stability").closest("button")!;
    expect(runStability).not.toBeDisabled();
    fireEvent.click(runStability);
    expect(startStability.mutate).toHaveBeenCalledWith({ hostAgentId: "h1", n: 4 });
  });

  it("shows the variance block with mean ± stddev (n) + an indicative-only marker", () => {
    dash = makeDash({
      stability: {
        recall: { mean: 0.8, stddev: 0.05, n: 3, indicative: true },
        precision: { mean: 0.6, stddev: 0, n: 3, indicative: true },
        citation_accuracy: null,
        cost: null,
        runs_completed: 3,
        runs_failed: 0,
      },
      stability_group: {
        id: "g1",
        workspace_id: "w",
        skill_id: "k1",
        skill_version: 4,
        host_agent_id: "a1",
        host_agent_version: 7,
        n_requested: 3,
        status: "done",
        run_ids: ["s3", "s4", "s5"],
        ran_at: new Date().toISOString(),
      },
    });
    renderView();

    expect(screen.getByText("80% ± 5pts (n=3)")).toBeInTheDocument();
    expect(screen.getByText("60% ± 0pts (n=3)")).toBeInTheDocument();
    // citation_accuracy null → rendered "—"
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    // indicative marker present (n < 5)
    expect(screen.getAllByText("indicative only").length).toBeGreaterThan(0);
  });

  it("lists per-case flaky / non-discriminating chips (icon + text)", () => {
    dash = makeDash({
      stability: {
        recall: { mean: 0.8, stddev: 0, n: 3, indicative: true },
        precision: null,
        citation_accuracy: null,
        cost: null,
        runs_completed: 3,
        runs_failed: 0,
      },
      case_stability: [
        { case_id: "c1", pass_rate: 0.5, runs: 4, flaky: true, non_discriminating: false },
        { case_id: "c2", pass_rate: 0, runs: 4, flaky: false, non_discriminating: true },
      ],
    });
    renderView();

    expect(screen.getByText("flaky")).toBeInTheDocument();
    expect(screen.getByText("non-discriminating")).toBeInTheDocument();
    expect(screen.getByText("50% pass · 4 runs")).toBeInTheDocument();
  });

  it("shows the noise-aware alert as a warning when the move is beyond the band", () => {
    dash = makeDash({
      stability_alert: { metric: "precision", move: 3, band: 1, beyond_band: true },
    });
    renderView();
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Precision dropped 3pts — beyond the 1pt noise band");
  });

  it("dampens a within-band move to a muted noise annotation", () => {
    dash = makeDash({
      stability_alert: { metric: "recall", move: 2, band: 5, beyond_band: false },
    });
    renderView();
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Recall moved 2pts — within the 5pt noise band (noise)");
  });

  it("shows the empty-state copy when no stability group has run", () => {
    dash = makeDash();
    renderView();
    expect(
      screen.getByText("No stability run yet — run one to sample the delta's variance."),
    ).toBeInTheDocument();
  });
});
