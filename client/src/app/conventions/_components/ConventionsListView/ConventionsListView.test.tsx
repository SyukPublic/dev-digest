import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import type { ConventionCandidate } from "@devdigest/shared";
import messages from "../../../../../messages/en/conventions.json";
import { ToastProvider } from "@/lib/toast";

const REPO_ID = "repo-1";

const refetchMock = vi.fn();
const mutateAsyncMock = vi.fn();
const updateMutate = vi.fn();
const extractProgressMock = vi.fn();

// Controlled state for the hook mocks — reassigned per test, read at call time.
let conventionsData: ConventionCandidate[] | undefined;
let progress: { events: { kind: string; msg: string }[]; running: boolean };

// AppShell pulls in shell hooks that need a QueryClient — render children straight through.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ repoId: REPO_ID, activeRepo: { id: REPO_ID, name: "dev-digest" } }),
}));

vi.mock("@/lib/hooks/conventions", () => ({
  useConventions: () => ({
    data: conventionsData,
    isLoading: false,
    isError: false,
    refetch: refetchMock,
  }),
  useExtractConventions: () => ({ mutateAsync: mutateAsyncMock, isPending: false }),
  useUpdateConvention: () => ({ mutate: updateMutate, isPending: false }),
  useExtractProgress: (...args: unknown[]) => extractProgressMock(...args),
}));

import { ConventionsListView } from "./ConventionsListView";

function cand(over: Partial<ConventionCandidate>): ConventionCandidate {
  return {
    id: "c1",
    rule: "Use X",
    evidence_path: "a.ts",
    evidence_snippet: "x",
    confidence: 0.9,
    accepted: false,
    category: "formatting",
    source: "llm",
    occurrences: null,
    extracted_at: null,
    ...over,
  };
}

const CANDIDATES: ConventionCandidate[] = [
  cand({ id: "1", category: "formatting" }),
  cand({ id: "2", category: "imports" }),
];

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ToastProvider>
        <ConventionsListView />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  refetchMock.mockReset();
  mutateAsyncMock.mockReset();
  updateMutate.mockReset();
  extractProgressMock.mockReset();
  mutateAsyncMock.mockResolvedValue({ jobId: "job-x" });
  extractProgressMock.mockImplementation(() => progress);
  conventionsData = CANDIDATES;
  progress = { events: [], running: false };
});

describe("ConventionsListView — F2 SSE live progress", () => {
  it("re-scan captures the jobId and shows the live progress line", async () => {
    progress = { events: [{ kind: "info", msg: "Parsing config files…" }], running: true };
    renderView();

    // Nothing scanning yet → no progress line, even though the stream has events.
    expect(screen.queryByText("Parsing config files…")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Re-scan" }));

    // The jobId returned by mutateAsync is captured into state and threaded into
    // the progress hook — fails if the setJobId capture is reverted.
    await waitFor(() => expect(extractProgressMock).toHaveBeenCalledWith(REPO_ID, "job-x"));

    // The latest event's msg renders as the live progress line.
    expect(await screen.findByText("Parsing config files…")).toBeInTheDocument();
  });

  it("stream completion refetches the list and clears the progress line", async () => {
    progress = { events: [{ kind: "info", msg: "Merging accepted rules…" }], running: true };
    const { rerender } = renderView();

    fireEvent.click(screen.getByRole("button", { name: "Re-scan" }));
    expect(await screen.findByText("Merging accepted rules…")).toBeInTheDocument();
    // While running, the list query has NOT been re-fetched.
    expect(refetchMock).not.toHaveBeenCalled();

    // SSE stream ends: running flips true → false.
    progress = { events: [{ kind: "info", msg: "Merging accepted rules…" }], running: false };
    rerender(
      <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
        <ToastProvider>
          <ConventionsListView />
        </ToastProvider>
      </NextIntlClientProvider>,
    );

    // The running→false transition reloads the list and clears the progress line —
    // fails if the refetch/clear effect is reverted.
    await waitFor(() => expect(refetchMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByText("Merging accepted rules…")).not.toBeInTheDocument(),
    );
  });
});
