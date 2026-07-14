import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { CiExport, CiExportRequestBody } from "@devdigest/shared";
import ciMessages from "../../../../../../../../../../messages/en/ci.json";
import { ToastProvider } from "@/lib/toast";

// The one mutation drives both preview (action:'files') and install (open_pr);
// the mock resolves synchronously so step transitions are testable without waits.
const exportMutate = vi.fn(
  (_body: CiExportRequestBody, opts?: { onSuccess?: (d: CiExport) => void }) => opts?.onSuccess?.(exportResponse),
);
let exportResponse: CiExport;

vi.mock("@/lib/hooks/ci", () => ({
  useExportCi: () => ({ mutate: exportMutate, isPending: false }),
}));

import { ExportWizard } from "./ExportWizard";

const FILES = [
  { path: ".devdigest/agents/security-reviewer.yaml", contents: "name: sec", editable: true },
  { path: ".github/workflows/devdigest-review.yml", contents: "on: pull_request", editable: true },
  { path: ".devdigest/memory.jsonl", contents: "", editable: false },
];

beforeEach(() => {
  exportResponse = {
    installation: { id: "i1", agent_id: "ag1", repo: "acme/api", target_type: "gha", installed_at: "2026-07-14T00:00:00Z" },
    files: FILES,
    pr_url: null,
  };
});

afterEach(() => {
  exportMutate.mockClear();
  cleanup();
});

function renderWizard() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>
      <ToastProvider>
        <ExportWizard agentId="ag1" agentName="Security Reviewer" onClose={() => {}} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

/** Fill the repo on Step 1 and click Continue into Step 2 (Preview). */
function gotoPreview() {
  fireEvent.change(screen.getByPlaceholderText("acme/payments-api"), { target: { value: "acme/api" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

describe("ExportWizard (AC-1, AC-6, AC-24..AC-28)", () => {
  it("shows the four target cards, GitHub Actions preselected + recommended (test_wizard_opens / test_target_cards)", () => {
    renderWizard();
    expect(screen.getByText("Export to CI")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /GitHub Actions/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /CircleCI/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Jenkins/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generic CLI/ })).toBeInTheDocument();
    expect(screen.getAllByText("recommended").length).toBeGreaterThan(0);
  });

  it("disables the non-GHA targets and cannot advance without a repo (test_disabled_target)", () => {
    renderWizard();
    expect(screen.getByRole("button", { name: /CircleCI/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Jenkins/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Generic CLI/ })).toBeDisabled();
    // Continue is blocked until a repo is entered (GHA is preselected).
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("acme/payments-api"), { target: { value: "acme/api" } });
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("previews the generated files in an editable editor (test_preview_editor)", () => {
    renderWizard();
    gotoPreview();
    expect(exportMutate).toHaveBeenCalledTimes(1);
    expect(exportMutate.mock.calls[0]![0].action).toBe("files");
    // File list + auto-selected first file in the editor, with the editable badge.
    expect(screen.getByRole("button", { name: ".devdigest/agents/security-reviewer.yaml" })).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("name: sec");
    expect(screen.getByText("editable")).toBeInTheDocument();
  });

  it("carries a Step-2 edit into the Install request (test_edited_file_carried)", () => {
    renderWizard();
    gotoPreview();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "name: edited" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" })); // → Configure
    fireEvent.click(screen.getByRole("button", { name: "Continue" })); // → Install
    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    const openPr = exportMutate.mock.calls.find((c) => c[0].action === "open_pr");
    expect(openPr).toBeDefined();
    const edited = openPr![0].files?.find((f) => f.path === ".devdigest/agents/security-reviewer.yaml");
    expect(edited?.contents).toBe("name: edited");
  });

  it("configures triggers + post-as and shows the block-merge hint (test_configure_step / test_block_merge_hint)", () => {
    renderWizard();
    gotoPreview();
    fireEvent.click(screen.getByRole("button", { name: "Continue" })); // → Configure

    expect(screen.getByRole("button", { name: "pull_request:opened" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "pull_request:reopened" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("GitHub review")).toBeInTheDocument();
    expect(screen.getByText("None (exit code only)")).toBeInTheDocument();
    // AC-19 "No GitHub App needed" hint.
    expect(screen.getByText("Block merge on findings")).toBeInTheDocument();
    expect(screen.getByText(/No GitHub App needed/)).toBeInTheDocument();
  });

  it("installs by opening a PR and toasts the PR link (test_install_step / test_pr_link_toast)", () => {
    exportResponse.pr_url = "https://github.com/acme/api/pull/7";
    renderWizard();
    gotoPreview();
    fireEvent.click(screen.getByRole("button", { name: "Continue" })); // → Configure
    fireEvent.click(screen.getByRole("button", { name: "Continue" })); // → Install

    expect(screen.getByText("Open a PR with these files")).toBeInTheDocument();
    expect(screen.getByText("Copy files as a zip")).toBeInTheDocument();
    expect(screen.getByText("GitHub Action setup docs →")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    const openPr = exportMutate.mock.calls.find((c) => c[0].action === "open_pr");
    expect(openPr).toBeDefined();
    // Success toast carries the PR link.
    expect(screen.getByText(/github\.com\/acme\/api\/pull\/7/)).toBeInTheDocument();
  });
});
