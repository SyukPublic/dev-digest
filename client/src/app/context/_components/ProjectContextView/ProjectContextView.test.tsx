import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { DiscoveredDocument, DocumentContent } from "@devdigest/shared";
import messages from "../../../../../messages/en/context.json";

// Repo identity for the viewer header.
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ repoId: "r1", activeRepo: { name: "acme/app" } }),
}));

// AppShell needs router/query context we don't want here — passthrough it.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Mutable fixtures for the discover + content hooks (repo convention: mock hooks).
let mockDocs: { data: DiscoveredDocument[] | undefined; isLoading: boolean; isError: boolean; refetch: () => void } = {
  data: undefined,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};
let mockContent: { data: DocumentContent | undefined; isLoading: boolean } = { data: undefined, isLoading: false };

vi.mock("@/lib/hooks/project-context", () => ({
  useProjectContextDocs: () => mockDocs,
  useDocumentContent: () => mockContent,
}));

import { ProjectContextView } from "./ProjectContextView";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockDocs = { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
  mockContent = { data: undefined, isLoading: false };
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ProjectContextView />
    </NextIntlClientProvider>,
  );
}

const DOCS: DiscoveredDocument[] = [
  { path: "specs/public-api.md", folder_type: "specs", tokens: 120, used_by_agents: 3 },
  { path: "docs/architecture.md", folder_type: "docs", tokens: 88 },
];

describe("Project Context page (T19, T20)", () => {
  it("lists discovered docs with folder-type badge; Preview renders markdown, Edit shows raw read-only (no Save)", () => {
    mockDocs = { ...mockDocs, data: DOCS };
    mockContent = {
      data: { path: "specs/public-api.md", content: "# API\n\nHello **world**", tokens: 120, folder_type: "specs" },
      isLoading: false,
    };
    renderView();

    // File list shows both docs by name + a folder-type badge each.
    expect(screen.getByText("public-api.md")).toBeInTheDocument();
    expect(screen.getByText("architecture.md")).toBeInTheDocument();
    expect(screen.getAllByText("specs").length).toBeGreaterThan(0);
    expect(screen.getByText("docs")).toBeInTheDocument();

    // Preview mode renders markdown (the heading becomes an <h1>).
    expect(screen.getByRole("heading", { name: "API" })).toBeInTheDocument();

    // Switch to Edit → raw source shown, and there is NO Save affordance (v1).
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    expect(screen.getByText(/# API/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });

  it("shows a friendly empty state when no documents are discovered", () => {
    mockDocs = { ...mockDocs, data: [] };
    renderView();
    expect(screen.getByText("No project context yet")).toBeInTheDocument();
    // Non-error: no retry affordance for an empty (not failed) list.
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });
});
