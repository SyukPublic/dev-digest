import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, EvalCaseDraft } from "@devdigest/shared";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import evalMessages from "../../../../../../../../messages/en/eval.json";
import { ToastProvider } from "@/lib/toast";

vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

const DRAFT: EvalCaseDraft = {
  agent_id: "a1",
  agent_name: "Security Reviewer",
  name: "Hardcoded secret",
  input_diff: "diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n@@ -1 +1 @@\n+const k = 'x';",
  input_meta: { title: "PR title", body: "PR body" },
  expected_output: {
    expectation: "must_find",
    findings: [{ file: "src/config.ts", start_line: 11, end_line: 11 }],
  },
};

// The "Turn into eval case" flow: derive the draft (onSuccess → open editor),
// then the Case Editor's create hook persists it on Save.
const draftFromFinding = {
  mutate: vi.fn((_id: string, opts?: { onSuccess?: (d: EvalCaseDraft) => void }) => opts?.onSuccess?.(DRAFT)),
  isPending: false,
};
const create = { mutateAsync: vi.fn().mockResolvedValue({ id: "c-new" }), isPending: false };
const update = { mutateAsync: vi.fn().mockResolvedValue({ id: "c1" }), isPending: false };
const run = { mutateAsync: vi.fn().mockResolvedValue({ id: "r" }), isPending: false };

vi.mock("@/lib/hooks/eval", () => ({
  useEvalCaseDraftFromFinding: () => draftFromFinding,
  useEvalCase: () => ({ data: undefined, isLoading: false }),
  useCreateEvalCase: () => create,
  useUpdateEvalCase: () => update,
  useRunCase: () => run,
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(() => {
  cleanup();
  draftFromFinding.mutate.mockClear();
  create.mutateAsync.mockClear();
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
    <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages, eval: evalMessages }}>
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

  it("'Turn into eval case' derives a draft, opens the Case Editor, and Save persists it (AC-1/AC-2)", async () => {
    renderWithIntl(<FindingsPanel findings={[{ ...FINDINGS[0]!, accepted_at: "2026-07-10T00:00:00Z" }]} prId="pr1" />);

    // Click → derive the draft for this finding.
    fireEvent.click(screen.getByText("Turn into eval case"));
    expect(draftFromFinding.mutate).toHaveBeenCalledWith("f1", expect.anything());

    // The editor opens prefilled from the draft (agent name in the subtitle).
    expect(await screen.findByText(/Security Reviewer/)).toBeInTheDocument();
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    expect(nameInput.value).toBe("Hardcoded secret");

    // Save → creates the case on the agent + success toast.
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(create.mutateAsync).toHaveBeenCalled());
    expect(await screen.findByText("Eval case created")).toBeInTheDocument();
  });
});
