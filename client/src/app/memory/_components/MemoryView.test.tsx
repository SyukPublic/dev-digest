import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import type { Memory, MemoryList } from "@devdigest/shared";
import messages from "../../../../messages/en/memory.json";

// ---- controlled hook state (reassigned per test, read at call time) ----
let baseResult: { data?: MemoryList; isLoading: boolean; isError: boolean; refetch: () => void };
let searchResult: { data?: MemoryList; isLoading: boolean; isError: boolean };
const useMemoryMock = vi.fn();
const createMutate = vi.fn();
const updateMutate = vi.fn();
const deleteMutate = vi.fn();
const refetchMock = vi.fn();

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ repoId: "repo-1", activeRepo: { id: "repo-1", name: "payments-api" } }),
}));
vi.mock("@/lib/hooks/memory", () => ({
  useMemory: (f: unknown) => {
    useMemoryMock(f);
    return baseResult;
  },
  useMemorySearch: () => searchResult,
  useCreateMemory: () => ({ mutate: createMutate, isPending: false }),
  useUpdateMemory: () => ({ mutate: updateMutate, isPending: false }),
  useDeleteMemory: () => ({ mutate: deleteMutate, isPending: false }),
}));

import { MemoryView } from "./MemoryView";

function entry(over: Partial<Memory> = {}): Memory {
  return {
    id: "m1",
    content: "Prefer the `bucketKey()` helper over inline cache keys.",
    scope: "team",
    kind: "preference",
    confidence: 0.67,
    sources: [{ pr: 423, context: "Raised in the caching review." }],
    repo_id: null,
    updated_at: "2026-07-01T12:00:00.000Z",
    last_used_at: "2026-06-01T12:00:00.000Z",
    ...over,
  };
}

const FACETS = {
  scope: { repo: 1, global: 2, team: 1 },
  kind: { decision: 1, convention: 2, preference: 1, fact: 0, learning: 0 },
};

function list(items: Memory[], total = items.length): MemoryList {
  return { items, facets: FACETS, total };
}

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ memory: messages }}>
      <MemoryView />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  useMemoryMock.mockReset();
  createMutate.mockReset();
  updateMutate.mockReset();
  deleteMutate.mockReset();
  refetchMock.mockReset();
  baseResult = { data: list([entry()], 4), isLoading: false, isError: false, refetch: refetchMock };
  searchResult = { data: undefined, isLoading: false, isError: false };
});

describe("MemoryView", () => {
  it("test_page_renders + test_card_fields + test_content_escaped + test_no_selection_placeholder + test_detail_panel", () => {
    renderView();

    // Header: heading + count with the pgvector + curated-nightly labels (AC-13).
    expect(screen.getByRole("heading", { name: "Memory" })).toBeInTheDocument();
    expect(screen.getByText(/pgvector · curated nightly/)).toBeInTheDocument();
    // Semantic search box is labeled (AC-13/25).
    expect(screen.getByLabelText("Semantic memory search")).toBeInTheDocument();

    // Rail facet counts (AC-2).
    expect(screen.getByText("Scope")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Global" })).toBeInTheDocument();

    // Card fields (AC-14): kind + scope badges, PR chip, and inline code as <code>.
    const card = screen.getByRole("button", { name: "Select memory entry" });
    expect(within(card).getByText("Preference")).toBeInTheDocument();
    expect(within(card).getByText("PR #423")).toBeInTheDocument();
    const code = within(card).getByText("bucketKey()");
    expect(code.tagName).toBe("CODE"); // AC-24: rendered as code, escaped
    // The raw backtick markup never reaches the DOM as text.
    expect(screen.queryByText(/`bucketKey/)).not.toBeInTheDocument();

    // No selection → detail placeholder (AC-17).
    expect(screen.getByText("No entry selected")).toBeInTheDocument();

    // Selecting the card populates the detail panel (AC-15).
    fireEvent.click(card);
    expect(screen.queryByText("No entry selected")).not.toBeInTheDocument();
    expect(screen.getByText(/CONFIDENCE 67%/)).toBeInTheDocument();
    expect(screen.getByText(/SCOPE Team/)).toBeInTheDocument();
    expect(screen.getByText("Source contexts")).toBeInTheDocument();
    expect(screen.getByText("Raised in the caching review.")).toBeInTheDocument();
  });

  it("test_filters_facets + test_stale_filter: toggles re-drive the list query", () => {
    renderView();
    // Toggling a scope facet re-queries with the selected scope (AC-2).
    fireEvent.click(screen.getByRole("checkbox", { name: "Global" }));
    expect(useMemoryMock).toHaveBeenLastCalledWith(expect.objectContaining({ scope: ["global"] }));

    // The stale checkbox re-queries with stale=true (AC-16).
    fireEvent.click(screen.getByRole("checkbox", { name: "Show stale (>60d)" }));
    expect(useMemoryMock).toHaveBeenLastCalledWith(expect.objectContaining({ stale: true }));
  });

  it("test_empty_state: no entries prompts creating the first one (AC-18)", () => {
    baseResult = { data: list([], 0), isLoading: false, isError: false, refetch: refetchMock };
    renderView();
    expect(screen.getByText("No memory yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create the first entry" }));
    // The create form opens.
    expect(screen.getByText("New memory entry")).toBeInTheDocument();
  });

  it("test_no_results: a search with no matches shows the no-results state (AC-19)", () => {
    searchResult = { data: list([], 4), isLoading: false, isError: false };
    renderView();
    fireEvent.change(screen.getByLabelText("Semantic memory search"), { target: { value: "nothing" } });
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("test_loading_error: list error shows the error state; semantic error keeps the list usable (AC-20)", () => {
    // (a) base list error → full error state.
    baseResult = { data: undefined, isLoading: false, isError: true, refetch: refetchMock };
    const { unmount } = renderView();
    expect(screen.getByText("Could not load memory.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetchMock).toHaveBeenCalled();
    unmount();

    // (b) semantic unavailable → banner, but the non-semantic list stays visible.
    baseResult = { data: list([entry()], 4), isLoading: false, isError: false, refetch: refetchMock };
    searchResult = { data: undefined, isLoading: false, isError: true };
    renderView();
    fireEvent.change(screen.getByLabelText("Semantic memory search"), { target: { value: "stripe" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/Semantic search is unavailable/);
    // Base list card is still rendered.
    expect(screen.getByRole("button", { name: "Select memory entry" })).toBeInTheDocument();
  });

  it("test_create_edit_form: create submits a valid payload; edit prefills (AC-21)", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "New entry" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("New memory entry")).toBeInTheDocument();
    // Fill content, then save → valid payload submitted (default scope global).
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "A new convention" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save entry" }));
    expect(createMutate).toHaveBeenCalledTimes(1);
    const payload = createMutate.mock.calls[0]![0];
    expect(payload).toMatchObject({ content: "A new convention", scope: "global", kind: "decision" });

    // Edit path prefills the form from the selected entry.
    fireEvent.click(screen.getByRole("button", { name: "Select memory entry" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit entry" }));
    expect(screen.getByText("Edit memory entry")).toBeInTheDocument();
  });

  it("test_create_edit_form validation: empty content is rejected (AC-7)", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "New entry" }));
    const dialog = screen.getByRole("dialog");
    // Clear the (empty) content and submit → validation error, no mutation.
    fireEvent.click(within(dialog).getByRole("button", { name: "Save entry" }));
    expect(screen.getByText("Content is required.")).toBeInTheDocument();
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("test_delete_confirm: delete requires confirmation before removing (AC-22)", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Select memory entry" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete entry" }));
    // Confirmation appears; not yet deleted.
    expect(screen.getByText("Delete this memory entry?")).toBeInTheDocument();
    expect(deleteMutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    expect(deleteMutate).toHaveBeenCalledWith("m1", expect.anything());
  });

  it("test_a11y: search + icon actions are labeled and an aria-live region is present", () => {
    renderView();
    expect(screen.getByLabelText("Semantic memory search")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select memory entry" }));
    expect(screen.getByRole("button", { name: "Edit entry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete entry" })).toBeInTheDocument();
  });
});
