import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, DiscoveredDocument, SpecAttachment } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/context.json";

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ repoId: "r1", activeRepo: { name: "acme/app" } }),
}));

// The Preview drawer content hook (only fires when a drawer opens).
vi.mock("@/lib/hooks/project-context", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hooks/project-context")>(
    "@/lib/hooks/project-context",
  );
  return {
    ...actual,
    useProjectContextDocs: () => mockDocs,
    useAttachedSpecs: () => mockAttached,
    useSetAttachedSpecs: () => ({ mutate: setSpecsMutate }),
    useDocumentContent: () => ({ data: undefined, isLoading: false, isError: false }),
  };
});

let mockDocs: { data: DiscoveredDocument[] | undefined; isLoading: boolean } = { data: undefined, isLoading: false };
let mockAttached: { data: SpecAttachment[] | undefined } = { data: undefined };
const setSpecsMutate = vi.fn();

import { ContextTab } from "./ContextTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockDocs = { data: undefined, isLoading: false };
  mockAttached = { data: undefined };
});

const AGENT = { id: "ag1", name: "Reviewer" } as Agent;

const DOCS: DiscoveredDocument[] = [
  { path: "specs/public-api.md", folder_type: "specs", tokens: 120, used_by_agents: 2 },
  { path: "docs/architecture.md", folder_type: "docs", tokens: 90 },
  { path: "insights/gotchas.md", folder_type: "insights", tokens: 40 },
];

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ContextTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

describe("Agent Context tab", () => {
  it("shows the 'Project context' section with attached docs checked and ordered first (T21)", () => {
    mockDocs = { data: DOCS, isLoading: false };
    mockAttached = { data: [{ path: "docs/architecture.md", order: 0 }] };
    renderTab();

    expect(screen.getByText("Project context")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 attached")).toBeInTheDocument();

    // Attached doc (architecture.md) leads; its checkbox is checked.
    const rows = screen.getAllByTestId("context-row");
    expect(within(rows[0]!).getByText("architecture.md")).toBeInTheDocument();
    const checkedBoxes = screen.getAllByRole("checkbox").filter((c) => (c as HTMLInputElement).checked);
    expect(checkedBoxes).toHaveLength(1);
  });

  it("toggling a doc persists the full ordered attached path set (T23)", () => {
    mockDocs = { data: DOCS, isLoading: false };
    mockAttached = { data: [] };
    renderTab();

    fireEvent.click(screen.getByRole("checkbox", { name: /Attach public-api\.md/ }));
    expect(setSpecsMutate).toHaveBeenCalledWith({ id: "ag1", paths: ["specs/public-api.md"] });
  });

  it("shows per-doc token counts, a total, and a warn indicator when over the soft budget (T24)", () => {
    // Two big docs push the attached total past the soft budget.
    mockDocs = {
      data: [
        { path: "specs/a.md", folder_type: "specs", tokens: 8000 },
        { path: "specs/b.md", folder_type: "specs", tokens: 7000 },
      ],
      isLoading: false,
    };
    mockAttached = { data: [{ path: "specs/a.md", order: 0 }, { path: "specs/b.md", order: 1 }] };
    renderTab();

    // Per-doc token counts render.
    expect(screen.getByText("8,000 tokens")).toBeInTheDocument();
    // Total over the 12k soft budget → warn badge, attaching not blocked.
    expect(screen.getByText("Over soft budget")).toBeInTheDocument();
    expect(screen.getByText("≈ 15,000 tokens")).toBeInTheDocument();
    // The aria-live total is present for screen readers.
    expect(screen.getByText("≈ 15,000 tokens")).toHaveAttribute("aria-live", "polite");
  });

  it("renders a 'missing' badge for an unresolved attached path and keeps it detachable (T25)", () => {
    mockDocs = { data: DOCS, isLoading: false };
    mockAttached = { data: [{ path: "specs/deleted.md", order: 0 }] };
    renderTab();

    expect(screen.getByText("missing")).toBeInTheDocument();
    // Its checkbox is checked and operable (detach persists the empty set).
    fireEvent.click(screen.getByRole("checkbox", { name: /Attach deleted\.md/ }));
    expect(setSpecsMutate).toHaveBeenCalledWith({ id: "ag1", paths: [] });
  });

  it("supports keyboard reorder via up/down buttons and persists the new order (T27)", () => {
    mockDocs = { data: DOCS, isLoading: false };
    mockAttached = {
      data: [
        { path: "specs/public-api.md", order: 0 },
        { path: "docs/architecture.md", order: 1 },
      ],
    };
    renderTab();

    // Move the 2nd attached doc up → it becomes first in the persisted order.
    fireEvent.click(screen.getByRole("button", { name: "Move architecture.md up" }));
    expect(setSpecsMutate).toHaveBeenCalledWith({
      id: "ag1",
      paths: ["docs/architecture.md", "specs/public-api.md"],
    });
  });

  it("shows an empty (non-error) list when no docs are discovered (T20)", () => {
    mockDocs = { data: [], isLoading: false };
    mockAttached = { data: [] };
    renderTab();
    expect(screen.getByText(/No documents found/)).toBeInTheDocument();
    expect(screen.queryByTestId("context-row")).not.toBeInTheDocument();
  });
});
