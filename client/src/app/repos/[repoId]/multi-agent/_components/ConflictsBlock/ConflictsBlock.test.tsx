import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Conflict } from "@devdigest/shared";
import runsMessages from "../../../../../../../messages/en/runs.json";
import { ConflictsBlock } from "./ConflictsBlock";

const CONFLICTS: Conflict[] = [
  {
    file: "src/a.ts",
    line: 10,
    title: "Race condition on shared cache",
    takes: [
      { agent_id: "a1", persona: "Security", verdict: "CRITICAL", note: "unguarded write" },
      { agent_id: "a2", persona: "Performance", verdict: "ignored", note: "" },
    ],
  },
  {
    file: "src/b.ts",
    line: 20,
    title: "Naming nit",
    takes: [
      { agent_id: "a1", persona: "Security", verdict: "SUGGESTION", note: "rename" },
      { agent_id: "a2", persona: "Performance", verdict: "SUGGESTION", note: "rename" },
    ],
  },
];

afterEach(cleanup);

function renderBlock(conflicts: Conflict[]) {
  render(
    <NextIntlClientProvider locale="en" messages={{ runs: runsMessages }}>
      <ConflictsBlock conflicts={conflicts} />
    </NextIntlClientProvider>,
  );
}

describe("ConflictsBlock (test_conflicts_block)", () => {
  it("renders the 'Where agents disagree' section including the 'did not flag' take (AC-20/AC-22)", () => {
    renderBlock(CONFLICTS);
    expect(screen.getByText("Where agents disagree")).toBeInTheDocument();
    expect(screen.getByText("Race condition on shared cache")).toBeInTheDocument();
    // The synthesized verdict='ignored' take reads "did not flag".
    expect(screen.getByText("did not flag")).toBeInTheDocument();
  });

  it("filters to only divergent locations when 'Show only conflicts' is enabled (AC-23)", () => {
    renderBlock(CONFLICTS);
    // Both locations show by default.
    expect(screen.getByText("Naming nit")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: "Show only conflicts" }));

    // The agreement (same verdict everywhere) is hidden; the disagreement stays.
    expect(screen.queryByText("Naming nit")).not.toBeInTheDocument();
    expect(screen.getByText("Race condition on shared cache")).toBeInTheDocument();
  });

  it("shows the agents-agree empty state when there are no conflicts (AC-37)", () => {
    renderBlock([]);
    expect(
      screen.getByText("No conflicts — the agents agree on every flagged location."),
    ).toBeInTheDocument();
  });
});
