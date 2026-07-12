import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import evalMessages from "../../../../messages/en/eval.json";
import { ToastProvider } from "@/lib/toast";
import { CaseEditor } from "./CaseEditor";

const create = { mutateAsync: vi.fn().mockResolvedValue({ id: "c-new" }), isPending: false };
const update = { mutateAsync: vi.fn().mockResolvedValue({ id: "c1" }), isPending: false };
const run = { mutateAsync: vi.fn().mockResolvedValue({ run_id: "r", case_id: "c", result: {} }), isPending: false };

vi.mock("@/lib/hooks/eval", () => ({
  useEvalCase: () => ({ data: undefined, isLoading: false }),
  useCreateEvalCase: () => create,
  useUpdateEvalCase: () => update,
  useRunCase: () => run,
}));

afterEach(cleanup);
beforeEach(() => {
  create.mutateAsync.mockClear();
  update.mutateAsync.mockClear();
});

function renderEditor() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <ToastProvider>
        <CaseEditor agent={{ id: "a1", name: "Security Reviewer" }} onClose={() => {}} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("CaseEditor (new case)", () => {
  it("blocks Save on invalid JSON and enables it once the envelope is valid + named (AC-31)", async () => {
    renderEditor();
    const saveBtn = screen.getByText("Save").closest("button")!;

    // A fresh editor starts with a valid default envelope but an empty name → blocked.
    expect(saveBtn).toBeDisabled();
    expect(screen.getByText("valid JSON")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "stripe-key-leak" } });
    // Now name + valid JSON → Save enabled.
    expect(saveBtn).not.toBeDisabled();

    // Break the JSON → invalid indicator + Save blocked again.
    fireEvent.change(screen.getByPlaceholderText("Expected output"), { target: { value: "{ not json" } });
    expect(screen.getByText("invalid JSON")).toBeInTheDocument();
    expect(saveBtn).toBeDisabled();
  });

  it("saves a valid case by calling create", async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "c" } });
    fireEvent.change(screen.getByPlaceholderText("Expected output"), {
      target: { value: '{"expectation":"must_find","findings":[]}' },
    });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(create.mutateAsync).toHaveBeenCalled());
  });

  it("'+ Finding skeleton' inserts a finding into the envelope", () => {
    renderEditor();
    fireEvent.click(screen.getByText("+ Finding skeleton"));
    const ta = screen.getByPlaceholderText("Expected output") as HTMLTextAreaElement;
    expect(ta.value).toContain("src/file.ts");
    expect(JSON.parse(ta.value).findings).toHaveLength(1);
  });

  it("has no Files input tab (Diff | PR meta only)", () => {
    renderEditor();
    expect(screen.getByText("Diff")).toBeInTheDocument();
    expect(screen.getByText("PR meta")).toBeInTheDocument();
    expect(screen.queryByText("Files")).not.toBeInTheDocument();
  });

  it("prefills from a finding-derived initialDraft and calls onSaved after create", async () => {
    const onSaved = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
        <ToastProvider>
          <CaseEditor
            agent={{ id: "a1", name: "Security Reviewer" }}
            initialDraft={{
              agent_id: "a1",
              agent_name: "Security Reviewer",
              name: "Hardcoded secret",
              input_diff: "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n+x",
              input_meta: { title: "t", body: "b" },
              expected_output: { expectation: "must_find", findings: [{ file: "x.ts", start_line: 1, end_line: 1 }] },
            }}
            onSaved={onSaved}
            onClose={() => {}}
          />
        </ToastProvider>
      </NextIntlClientProvider>,
    );

    // Name is prefilled from the draft → Save is enabled immediately.
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Hardcoded secret");
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(create.mutateAsync).toHaveBeenCalled());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: "c-new" }));
  });

  it("Diff tab defaults to Preview; the segmented control switches to Edit", () => {
    renderEditor();
    // Preview by default: empty-preview hint shown, no diff textarea.
    expect(screen.getByText("No diff yet — switch to Edit to paste one.")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/--- a\/src\/config\.ts/)).not.toBeInTheDocument();
    // Switch to Edit → the diff textarea appears, preview hint goes away.
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    expect(screen.getByPlaceholderText(/--- a\/src\/config\.ts/)).toBeInTheDocument();
    expect(screen.queryByText("No diff yet — switch to Edit to paste one.")).not.toBeInTheDocument();
  });

  it("legacy agent call site saves owner_kind='agent' with the agent id (AC-2)", async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "c" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(create.mutateAsync).toHaveBeenCalled());
    expect(create.mutateAsync.mock.calls[0]![0]).toMatchObject({ owner_kind: "agent", owner_id: "a1" });
  });
});

describe("CaseEditor (skill owner)", () => {
  function renderSkillEditor() {
    return render(
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
        <ToastProvider>
          <CaseEditor owner={{ kind: "skill", id: "s1", name: "pr-quality-rubric" }} onClose={() => {}} />
        </ToastProvider>
      </NextIntlClientProvider>,
    );
  }

  it("saves the case with owner_kind='skill' and the skill id (AC-2)", async () => {
    renderSkillEditor();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "sql-injection" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(create.mutateAsync).toHaveBeenCalled());
    expect(create.mutateAsync.mock.calls[0]![0]).toMatchObject({ owner_kind: "skill", owner_id: "s1" });
  });

  it("hides the inline Run controls for a skill (a skill run needs a host, AC-2)", () => {
    renderSkillEditor();
    // "Run on save" toggle is agent-only; skill runs happen from the Evals tab.
    expect(screen.queryByText("Run on save")).not.toBeInTheDocument();
  });
});
