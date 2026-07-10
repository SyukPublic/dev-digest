import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCompareResult } from "@devdigest/shared";
import evalMessages from "../../../../messages/en/eval.json";
import { CompareModal } from "./CompareModal";

let compareData: EvalCompareResult | undefined;
vi.mock("@/lib/hooks/eval", () => ({
  useCompareRuns: () => ({ data: compareData, isLoading: false }),
}));

afterEach(cleanup);

function suite(v: number, extra: Partial<EvalCompareResult["run_a"]> = {}) {
  return {
    id: `s${v}`, workspace_id: "w", agent_id: "a", agent_version: v, status: "done" as const,
    recall: 0.9, precision: 0.85, citation_accuracy: 0.95, passed: 17, total: 20, cost_usd: 0.05, duration_ms: 1000,
    ran_at: new Date().toISOString(), ...extra,
  };
}

function renderCompare() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <CompareModal a="s6" b="s7" onClose={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("CompareModal", () => {
  it("shows metric delta tiles + a prompt diff, and has NO Promote control (AC-27)", () => {
    compareData = {
      run_a: suite(6, { precision: 0.87 }),
      run_b: suite(7),
      delta: { recall: 0, precision: -0.02, citation_accuracy: 0, cost_usd: 0.01 },
      system_prompt_a: "You are a reviewer.\nBe terse.",
      system_prompt_b: "You are a strict reviewer.\nBe terse.",
      config_available: true,
    };
    renderCompare();
    expect(screen.getByText("Recall")).toBeInTheDocument();
    expect(screen.getByText("Precision")).toBeInTheDocument();
    expect(screen.getByText("Citation")).toBeInTheDocument();
    expect(screen.getByText("Cost")).toBeInTheDocument();
    // The prompt diff shows the changed (added) new-side line.
    expect(screen.getByText(/You are a strict reviewer\./)).toBeInTheDocument();
    // No promote control anywhere; Close is the only footer button.
    expect(screen.queryByText(/promote/i)).not.toBeInTheDocument();
    expect(screen.getByText("Close")).toBeInTheDocument();
  });

  it("degrades to 'config unavailable' when a version row is missing (AC-28)", () => {
    compareData = {
      run_a: suite(6),
      run_b: suite(7),
      delta: { recall: 0, precision: 0, citation_accuracy: 0, cost_usd: 0 },
      system_prompt_a: null,
      system_prompt_b: null,
      config_available: false,
    };
    renderCompare();
    expect(screen.getByText("config unavailable")).toBeInTheDocument();
  });
});
