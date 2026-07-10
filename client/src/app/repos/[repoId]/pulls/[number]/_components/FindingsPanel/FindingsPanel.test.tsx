import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { ToastProvider } from "@/lib/toast";

vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

const createEvalCase = {
  mutate: vi.fn((_id: string, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.()),
  isPending: false,
};
vi.mock("@/lib/hooks/eval", () => ({
  useCreateEvalCaseFromFinding: () => createEvalCase,
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(() => {
  cleanup();
  createEvalCase.mutate.mockClear();
});

const FINDINGS: FindingRecord[] = [
  {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });

  it("wires 'Turn into eval case' to the promote hook + toasts on success (AC-1/AC-2)", () => {
    renderWithIntl(<FindingsPanel findings={[{ ...FINDINGS[0]!, accepted_at: "2026-07-10T00:00:00Z" }]} prId="pr1" />);
    fireEvent.click(screen.getByText("Turn into eval case"));
    expect(createEvalCase.mutate).toHaveBeenCalledWith("f1", expect.anything());
    expect(screen.getByText("Eval case created")).toBeInTheDocument();
  });
});
