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
});
