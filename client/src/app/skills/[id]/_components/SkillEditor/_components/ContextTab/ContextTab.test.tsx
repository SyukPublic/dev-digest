import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, DiscoveredDocument, SpecAttachment } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/context.json";

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ repoId: "r1", activeRepo: { name: "acme/app" } }),
}));

vi.mock("@/lib/hooks/project-context", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hooks/project-context")>(
    "@/lib/hooks/project-context",
  );
  return {
    ...actual,
    useProjectContextDocs: () => mockDocs,
    useAttachedSpecs: () => mockAttached,
    useSetAttachedSpecs: () => ({ mutate: vi.fn() }),
    useDocumentContent: () => ({ data: undefined, isLoading: false, isError: false }),
  };
});

let mockDocs: { data: DiscoveredDocument[] | undefined; isLoading: boolean } = { data: undefined, isLoading: false };
let mockAttached: { data: SpecAttachment[] | undefined } = { data: undefined };

import { ContextTab } from "./ContextTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockDocs = { data: undefined, isLoading: false };
  mockAttached = { data: undefined };
});

const SKILL = { id: "sk1", name: "Security" } as Skill;

const DOCS: DiscoveredDocument[] = [
  { path: "specs/public-api.md", folder_type: "specs", tokens: 120 },
  { path: "docs/architecture.md", folder_type: "docs", tokens: 90 },
];

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ContextTab skill={SKILL} />
    </NextIntlClientProvider>,
  );
}

describe("Skill Context tab (T22)", () => {
  it("shows the 'Project context to use' section and a 'SERIALIZES AS' path list", () => {
    mockDocs = { data: DOCS, isLoading: false };
    mockAttached = { data: [{ path: "specs/public-api.md", order: 0 }] };
    renderTab();

    expect(screen.getByText("Project context to use")).toBeInTheDocument();
    expect(screen.getByText("1 attached")).toBeInTheDocument();

    // SERIALIZES AS block previews the attachment as a path list.
    expect(screen.getByText("SERIALIZES AS")).toBeInTheDocument();
    expect(screen.getByText(/## Project specifications/)).toBeInTheDocument();
    expect(screen.getByText(/- specs\/public-api\.md/)).toBeInTheDocument();
  });
});
