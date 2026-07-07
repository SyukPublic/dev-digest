import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace, FindingRecord } from "@devdigest/shared";
import runsMessages from "../../../../../../../../../../messages/en/runs.json"; // client/messages/en/runs.json

// Phase 8 owns the `trace.prompt.perSpec` string in messages/en/runs.json; until
// it lands, the test supplies the label locally so the subsection heading resolves
// without touching the shared JSON. Everything else comes from the real messages.
const messages = {
  runs: {
    ...runsMessages,
    trace: {
      ...runsMessages.trace,
      prompt: { ...runsMessages.trace.prompt, perSpec: "Per-specs tokens" },
    },
  },
};

const baseTrace: RunTrace = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, cost_usd: 0.06, findings: 0, grounding: "0/0 passed" },
  prompt_assembly: {
    system: "You are a reviewer.",
    skills: null,
    memory: null,
    specs: "## Project context\n<untrusted>…specs…</untrusted>",
    spec_tokens: [
      { path: "specs/security-baseline.md", tokens: 139 },
      { path: "specs/style-guide.md", tokens: 42 },
    ],
    user: "Review PR #482",
  },
  tool_calls: [],
  raw_output: "{}",
  memory_pulled: [],
  specs_read: ["specs/security-baseline.md", "specs/style-guide.md"],
  log: [],
};

const noFindings: FindingRecord[] = [];

afterEach(cleanup);

function renderTraceBody(trace: RunTrace) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <div data-theme="dark">
        <TraceBody trace={trace} findings={noFindings} />
      </div>
    </NextIntlClientProvider>,
  );
}

import { TraceBody } from "./TraceBody";

describe("TraceBody — Per-specs tokens subsection", () => {
  it("renders the per-document token breakdown from spec_tokens, in order, under the specs block", () => {
    renderTraceBody(baseTrace);

    // The "Specs read" configuration line lists the injected paths (already-existing behaviour).
    const specsReadRow = screen.getByText("Specs read").closest("div")!;
    expect(within(specsReadRow).getByText("specs/security-baseline.md")).toBeInTheDocument();
    expect(within(specsReadRow).getByText("specs/style-guide.md")).toBeInTheDocument();

    // Expand the Prompt assembly section, then the Specs prompt block to reveal `extra`.
    fireEvent.click(screen.getByText("Prompt assembly"));
    fireEvent.click(screen.getByText("Project context (dynamic)"));

    // The subsection heading renders.
    const heading = screen.getByText("Per-specs tokens");
    expect(heading).toBeInTheDocument();

    // Scope to the subsection wrapper so paths aren't confused with the Specs-read line.
    const subsection = heading.parentElement!;
    const rows = within(subsection).getAllByText(/^specs\/.+\.md$/);
    // Both docs appear in prompt-injection order (security-baseline before style-guide).
    expect(rows.map((el) => el.textContent)).toEqual([
      "specs/security-baseline.md",
      "specs/style-guide.md",
    ]);
    // Each row carries its own token count.
    expect(within(subsection).getByText("139 tokens")).toBeInTheDocument();
    expect(within(subsection).getByText("42 tokens")).toBeInTheDocument();
  });

  it("omits the subsection when spec_tokens is absent", () => {
    renderTraceBody({
      ...baseTrace,
      prompt_assembly: { ...baseTrace.prompt_assembly, spec_tokens: undefined },
    });

    fireEvent.click(screen.getByText("Prompt assembly"));
    fireEvent.click(screen.getByText("Project context (dynamic)"));

    expect(screen.queryByText("Per-specs tokens")).not.toBeInTheDocument();
  });
});
