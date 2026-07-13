import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import evalMessages from "../../../../messages/en/eval.json";
import { ToastProvider } from "@/lib/toast";
import { CaseEditor } from "./CaseEditor";

const create = { mutateAsync: vi.fn().mockResolvedValue({ id: "c-new" }), isPending: false };
const update = { mutateAsync: vi.fn().mockResolvedValue({ id: "c1" }), isPending: false };
const run = { mutateAsync: vi.fn().mockResolvedValue({ run_id: "r", case_id: "c", result: {} }), isPending: false };

// Mutable holder so a test can drive what `useEvalCase(caseId)` returns (edit mode).
let evalCaseData: unknown = undefined;

vi.mock("@/lib/hooks/eval", () => ({
  useEvalCase: () => ({ data: evalCaseData, isLoading: false }),
  useCreateEvalCase: () => create,
  useUpdateEvalCase: () => update,
  useRunCase: () => run,
}));

afterEach(cleanup);
beforeEach(() => {
  create.mutateAsync.mockClear();
  update.mutateAsync.mockClear();
  evalCaseData = undefined;
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

  it("renders a Files tab between Diff and PR meta (AC-1)", () => {
    renderEditor();
    expect(screen.getByText("Diff")).toBeInTheDocument();
    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByText("PR meta")).toBeInTheDocument();
    // Switching to Files keeps the dialog mounted (fixed-size Modal, no resize).
    fireEvent.click(screen.getByText("Files"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByText(/No files yet\. Add a file, then type its path and contents/),
    ).toBeInTheDocument();
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

  it("behaves identically for a skill owner: add a file and Save sends input_files + owner_kind='skill' (AC-21)", async () => {
    renderSkillEditor();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "sql-injection" } });
    fireEvent.click(screen.getByText("Files"));
    fireEvent.click(screen.getByRole("button", { name: "Add file" }));
    fireEvent.change(screen.getByLabelText("File path"), { target: { value: "src/db.ts" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(create.mutateAsync).toHaveBeenCalled());
    expect(create.mutateAsync.mock.calls[0]![0]).toMatchObject({
      owner_kind: "skill",
      owner_id: "s1",
      input_files: [{ path: "src/db.ts", content: "" }],
    });
  });
});

describe("CaseEditor — Files tab", () => {
  function open() {
    render(
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
        <ToastProvider>
          <CaseEditor agent={{ id: "a1", name: "Security Reviewer" }} onClose={() => {}} />
        </ToastProvider>
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByText("Files"));
  }

  it("shows the empty state, then an add-only file list + content editor after adding (AC-2, AC-4)", () => {
    open();
    // Empty state: prompt + Add control, no editor yet.
    expect(
      screen.getByText(/No files yet\. Add a file, then type its path and contents/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("File path")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add file" }));
    // List row + path + content editor + a per-file remove control appear.
    expect(screen.getByRole("list", { name: "Files in this case" })).toBeInTheDocument();
    expect(screen.getByLabelText("File path")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("// full file content — each line becomes an added line")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove file" })).toBeInTheDocument();
  });

  it("'Add file' appends a blank file, selects it, and focuses its path field (AC-3)", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Add file" }));
    expect(screen.getByLabelText("File path")).toHaveFocus();
  });

  it("editing a file re-renders the synthesized read-only Diff preview (AC-5, AC-7)", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Add file" }));
    fireEvent.change(screen.getByLabelText("File path"), { target: { value: "src/config.ts" } });
    fireEvent.change(screen.getByPlaceholderText("// full file content — each line becomes an added line"), {
      target: { value: "a\nb\nc" },
    });
    // Switch to the Diff tab: it is now the read-only synthesized diff.
    fireEvent.click(screen.getByText("Diff"));
    expect(screen.getByText(/Synthesized from the Files tab — read-only/)).toBeInTheDocument();
    // Edit/Preview toggle is hidden while files drive the diff.
    expect(screen.queryByRole("tab", { name: "Edit" })).not.toBeInTheDocument();
    // Added lines render with a `+` prefix (not colour alone, AC-20). Each diff
    // line is its own div; the hunk header + `+`-prefixed body lines are present.
    expect(screen.getByText("@@ -0,0 +1,3 @@")).toBeInTheDocument();
    expect(screen.getByText("+a")).toBeInTheDocument();
    expect(screen.getByText("+b")).toBeInTheDocument();
    expect(screen.getByText("+c")).toBeInTheDocument();
  });

  it("with zero files the Diff tab stays editable (Preview | Edit) exactly as today (AC-8)", () => {
    open();
    // No files added → back on Diff, the segmented control is present and editable.
    fireEvent.click(screen.getByText("Diff"));
    expect(screen.getByRole("tab", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByText(/Synthesized from the Files tab/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    expect(screen.getByPlaceholderText(/--- a\/src\/config\.ts/)).toBeInTheDocument();
  });

  it("a duplicate path blocks Save and surfaces the duplicatePath message (AC-12)", () => {
    open();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "dup-case" } });
    fireEvent.click(screen.getByRole("button", { name: "Add file" }));
    fireEvent.change(screen.getByLabelText("File path"), { target: { value: "same.ts" } });
    fireEvent.click(screen.getByRole("button", { name: "Add file" }));
    fireEvent.change(screen.getByLabelText("File path"), { target: { value: "same.ts" } });

    expect(screen.getByText('Two files share the path "same.ts". Paths must be unique.')).toBeInTheDocument();
    expect(screen.getByText("Save").closest("button")!).toBeDisabled();
  });

  it("an empty/whitespace path blocks Save and surfaces the emptyPath message (AC-13)", () => {
    open();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "empty-path" } });
    fireEvent.click(screen.getByRole("button", { name: "Add file" }));
    // Path left blank → blocked.
    expect(screen.getByText("Every file needs a non-empty path.")).toBeInTheDocument();
    expect(screen.getByText("Save").closest("button")!).toBeDisabled();
  });

  it("a file with empty content does NOT block Save and sends input_files (AC-14, AC-16)", async () => {
    open();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "empty-content" } });
    fireEvent.click(screen.getByRole("button", { name: "Add file" }));
    fireEvent.change(screen.getByLabelText("File path"), { target: { value: "src/config.ts" } });
    // Content deliberately left empty.
    expect(screen.getByText("Save").closest("button")!).not.toBeDisabled();
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(create.mutateAsync).toHaveBeenCalled());
    expect(create.mutateAsync.mock.calls[0]![0]).toMatchObject({
      input_files: [{ path: "src/config.ts", content: "" }],
    });
  });

  it("resolves all Files-tab text via next-intl (AC-19)", () => {
    open();
    // Tab label + empty prompt + add control from the eval namespace.
    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(
      screen.getByText(/No files yet\. Add a file, then type its path and contents/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add file" }));
    expect(screen.getByRole("list", { name: "Files in this case" })).toBeInTheDocument();
    expect(screen.getByLabelText("File path")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove file" })).toBeInTheDocument();
  });

  it("file list is keyboard-navigable with an announced selection (aria-current) and labelled controls (AC-20)", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Add file" }));
    fireEvent.change(screen.getByLabelText("File path"), { target: { value: "first.ts" } });
    fireEvent.click(screen.getByRole("button", { name: "Add file" }));
    fireEvent.change(screen.getByLabelText("File path"), { target: { value: "second.ts" } });

    // The just-added (second) row is the announced selection.
    const secondRow = screen.getByRole("button", { name: "second.ts" });
    expect(secondRow).toHaveAttribute("aria-current", "true");
    // Selecting the first row moves the announced selection and rebinds the editor.
    fireEvent.click(screen.getByRole("button", { name: "first.ts" }));
    expect(screen.getByRole("button", { name: "first.ts" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByLabelText("File path")).toHaveValue("first.ts");
    // Both remove controls are labelled.
    expect(screen.getAllByRole("button", { name: "Remove file" })).toHaveLength(2);
  });

  it("removing a file updates the set and returns to the empty state (AC-5)", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Add file" }));
    fireEvent.change(screen.getByLabelText("File path"), { target: { value: "gone.ts" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove file" }));
    expect(
      screen.getByText(/No files yet\. Add a file, then type its path and contents/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("File path")).not.toBeInTheDocument();
  });
});

describe("CaseEditor — default input tab (AC-9)", () => {
  function openEdit(data: unknown) {
    evalCaseData = data;
    return render(
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
        <ToastProvider>
          <CaseEditor agent={{ id: "a1", name: "Security Reviewer" }} caseId="c1" onClose={() => {}} />
        </ToastProvider>
      </NextIntlClientProvider>,
    );
  }

  const base = {
    name: "seeded",
    input_diff: "",
    input_meta: { title: "", body: "" },
    expected_output: { expectation: "must_find", findings: [] },
  };

  it("defaults to the Files tab when the case has files", () => {
    openEdit({ ...base, input_files: [{ path: "src/config.ts", content: "a" }] });
    // Files tab active → its file list is visible without switching tabs.
    expect(screen.getByRole("list", { name: "Files in this case" })).toBeInTheDocument();
    expect(screen.getByLabelText("File path")).toHaveValue("src/config.ts");
  });

  it("defaults to the Diff tab when the case has no files", () => {
    openEdit({ ...base, input_files: null });
    // Diff tab active → the Preview/Edit segmented control is visible.
    expect(screen.getByRole("tab", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Files in this case" })).not.toBeInTheDocument();
  });

  it("Save on an existing case (edit mode) calls update.mutateAsync with input_files (T24/AC-16)", async () => {
    openEdit({ ...base, input_files: [{ path: "src/config.ts", content: "a" }] });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(update.mutateAsync).toHaveBeenCalled());
    expect(update.mutateAsync.mock.calls[0]![0]).toMatchObject({
      id: "c1",
      input: expect.objectContaining({ input_files: [{ path: "src/config.ts", content: "a" }] }),
    });
  });
});
