import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
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

// Mutable repo context the mocked hooks read at call time (CiTab pattern).
let activeRepo: { full_name: string } | null;
let repos: { id: string; full_name: string }[];
const pushMock = vi.fn();
// Spy the zip helper — jsdom lacks URL.createObjectURL/anchor-download, so we
// assert the spy is called rather than exercising a real download.
const zipSpy = vi.fn();

vi.mock("@/lib/hooks/ci", () => ({
  useExportCi: () => ({ mutate: exportMutate, isPending: false }),
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo, repos, repoId: null, setRepoId: vi.fn(), reposLoaded: true }),
}));
vi.mock("@/lib/hooks/core", () => ({
  useRepos: () => ({ data: repos }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));
vi.mock("./zip", () => ({
  // Wrap in a lazy delegator: the factory is hoisted above the `zipSpy`
  // declaration, so referencing it eagerly here would throw "cannot access
  // before initialization". A nested arrow reads it only at call time.
  downloadBundleZip: (...args: unknown[]) => zipSpy(...args),
}));

import { ExportWizard } from "./ExportWizard";

const FILES = [
  { path: ".devdigest/agents/security-reviewer.yaml", contents: "name: sec", editable: true },
  { path: ".github/workflows/devdigest-review.yml", contents: "on: pull_request", editable: true },
  { path: ".devdigest/memory.jsonl", contents: "", editable: false },
];

beforeEach(() => {
  activeRepo = { full_name: "acme/api" };
  repos = [
    { id: "r1", full_name: "acme/api" },
    { id: "r2", full_name: "acme/web" },
  ];
  exportResponse = {
    installation: { id: "i1", agent_id: "ag1", repo: "acme/api", target_type: "gha", installed_at: "2026-07-14T00:00:00Z" },
    files: FILES,
    pr_url: null,
  };
});

afterEach(() => {
  exportMutate.mockClear();
  pushMock.mockClear();
  zipSpy.mockClear();
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

/** Open the Step-1 repo selector dropdown (its trigger is labelled by repoLabel). */
function openRepoSelector() {
  fireEvent.click(screen.getByRole("button", { name: "Target repository" }));
}

/** Advance Step 1 → Step 2 (Preview). Repo is prefilled from the active repo. */
function gotoPreview() {
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

/** Drive the wizard all the way to Step 4 (Install). */
function gotoInstall() {
  gotoPreview();
  fireEvent.click(screen.getByRole("button", { name: "Continue" })); // → Configure
  fireEvent.click(screen.getByRole("button", { name: "Continue" })); // → Install
}

describe("ExportWizard (AC-1, AC-6, AC-24..AC-28, AC-51..AC-54)", () => {
  it("shows the four target cards, GitHub Actions preselected + recommended (test_wizard_opens / test_target_cards)", () => {
    renderWizard();
    expect(screen.getByText("Export to CI")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /GitHub Actions/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /CircleCI/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Jenkins/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generic CLI/ })).toBeInTheDocument();
    expect(screen.getAllByText("recommended").length).toBeGreaterThan(0);
  });

  it("prefills the target repo from the shell's active repo and enables Continue (test_wizard_repo_prefill)", () => {
    renderWizard();
    // The selector trigger shows the active repo; Continue is enabled immediately.
    const trigger = screen.getByRole("button", { name: "Target repository" });
    expect(within(trigger).getByText("acme/api")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("uses a repo selector (not a free-text field) with an Add-repository item and no trash (test_wizard_repo_selector)", () => {
    renderWizard();
    // No free-text placeholder input from the old TextInput.
    expect(screen.queryByPlaceholderText("acme/payments-api")).toBeNull();
    openRepoSelector();
    // Both seeded repos + the "Add repository…" affordance are listed.
    expect(screen.getByRole("button", { name: "acme/web" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add repository…" })).toBeInTheDocument();
    // NO trash/remove affordance is rendered (AC-52).
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    // Picking a repo updates the trigger label.
    fireEvent.click(screen.getByRole("button", { name: "acme/web" }));
    const trigger = screen.getByRole("button", { name: "Target repository" });
    expect(within(trigger).getByText("acme/web")).toBeInTheDocument();
  });

  it("starts unselected when no active repo resolves and blocks Continue until one is picked (test_disabled_target)", () => {
    activeRepo = null;
    renderWizard();
    // Non-GHA targets stay disabled.
    expect(screen.getByRole("button", { name: /CircleCI/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Jenkins/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Generic CLI/ })).toBeDisabled();
    // No repo selected → Continue blocked.
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    openRepoSelector();
    fireEvent.click(screen.getByRole("button", { name: "acme/api" }));
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("routes the Add-repository item to /onboarding (test_wizard_repo_selector)", () => {
    renderWizard();
    openRepoSelector();
    fireEvent.click(screen.getByRole("button", { name: "Add repository…" }));
    expect(pushMock).toHaveBeenCalledWith("/onboarding");
  });

  it("previews the generated files in an editable editor (test_preview_editor)", () => {
    renderWizard();
    gotoPreview();
    expect(exportMutate).toHaveBeenCalledTimes(1);
    expect(exportMutate.mock.calls[0]![0].action).toBe("files");
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
    // Only editable files are round-tripped — the non-editable memory/runner are
    // excluded so the body stays under the server's 1 MB limit (server re-reads them).
    const paths = openPr![0].files?.map((f) => f.path) ?? [];
    expect(paths).toContain(".github/workflows/devdigest-review.yml");
    expect(paths).not.toContain(".devdigest/memory.jsonl");
  });

  it("configures triggers + post-as and shows the block-merge hint (test_configure_step / test_block_merge_hint)", () => {
    renderWizard();
    gotoPreview();
    fireEvent.click(screen.getByRole("button", { name: "Continue" })); // → Configure

    expect(screen.getByRole("button", { name: "pull_request:opened" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "pull_request:reopened" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("GitHub review")).toBeInTheDocument();
    expect(screen.getByText("None (exit code only)")).toBeInTheDocument();
    expect(screen.getByText("Block merge on findings")).toBeInTheDocument();
    expect(screen.getByText(/No GitHub App needed/)).toBeInTheDocument();
  });

  it("renders the install cards as a radiogroup with open-a-PR checked by default (test_install_radiogroup)", () => {
    renderWizard();
    gotoInstall();

    const group = screen.getByRole("radiogroup");
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(2);
    // "Open a PR" is the recommended, default-checked card.
    const openPrRadio = radios.find((r) => within(r).queryByText("Open a PR with these files"))!;
    const zipRadio = radios.find((r) => within(r).queryByText("Copy files as a zip"))!;
    expect(openPrRadio).toHaveAttribute("aria-checked", "true");
    expect(zipRadio).toHaveAttribute("aria-checked", "false");
    // The zip card copy + docs link come from the `ci` namespace.
    expect(screen.getByText("add them manually")).toBeInTheDocument();
    expect(screen.getByText("GitHub Action setup docs →")).toBeInTheDocument();

    // Selecting the zip card flips aria-checked (roving selection).
    fireEvent.click(zipRadio);
    expect(zipRadio).toHaveAttribute("aria-checked", "true");
    expect(openPrRadio).toHaveAttribute("aria-checked", "false");
  });

  it("moves selection with arrow keys (test_install_radiogroup)", () => {
    renderWizard();
    gotoInstall();
    const group = screen.getByRole("radiogroup");
    fireEvent.keyDown(group, { key: "ArrowDown" });
    const zipRadio = within(group).getAllByRole("radio").find((r) => within(r).queryByText("Copy files as a zip"))!;
    expect(zipRadio).toHaveAttribute("aria-checked", "true");
  });

  it("installs by opening a PR and toasts the PR link (test_install_step / test_pr_link_toast)", () => {
    exportResponse.pr_url = "https://github.com/acme/api/pull/7";
    renderWizard();
    gotoInstall();

    expect(screen.getByText("Open a PR with these files")).toBeInTheDocument();
    expect(screen.getByText("Copy files as a zip")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    const openPr = exportMutate.mock.calls.find((c) => c[0].action === "open_pr");
    expect(openPr).toBeDefined();
    expect(screen.getByText(/github\.com\/acme\/api\/pull\/7/)).toBeInTheDocument();
  });

  it("downloads a zip of the merged bundle with NO export mutation when 'files' is selected (test_zip_download_files)", () => {
    renderWizard();
    gotoInstall();
    // Carry a Step-2-style bundle by selecting the zip card, then Install.
    const zipRadio = within(screen.getByRole("radiogroup")).getAllByRole("radio").find((r) => within(r).queryByText("Copy files as a zip"))!;
    fireEvent.click(zipRadio);
    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    // The zip helper is called with the merged files + the repo name…
    expect(zipSpy).toHaveBeenCalledTimes(1);
    expect(zipSpy.mock.calls[0]![1]).toBe("acme/api");
    expect(zipSpy.mock.calls[0]![0].map((f: { path: string }) => f.path)).toContain(
      ".devdigest/agents/security-reviewer.yaml",
    );
    // …and NO open_pr export mutation runs (no PR, no installation).
    expect(exportMutate.mock.calls.find((c) => c[0].action === "open_pr")).toBeUndefined();
  });
});

describe("ci.json zip keys (test_ci_json_zip_keys)", () => {
  it("defines the install-card zip keys in the exportWizard namespace (AC-53)", () => {
    const w = ciMessages.exportWizard as Record<string, unknown>;
    expect(w.zipCardTitle).toBe("Copy files as a zip");
    expect(w.zipCardHint).toBe("add them manually");
    expect(w.docsLink).toBe("GitHub Action setup docs →");
  });
});
