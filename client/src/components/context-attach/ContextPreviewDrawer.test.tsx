import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { DiscoveredDocument, DocumentContent } from "@devdigest/shared";
import messages from "../../../messages/en/context.json";

let mockContent: { data: DocumentContent | undefined; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
};

vi.mock("@/lib/hooks/project-context", () => ({
  useDocumentContent: () => mockContent,
}));

import { ContextPreviewDrawer } from "./ContextPreviewDrawer";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockContent = { data: undefined, isLoading: false, isError: false };
});

const DOC: DiscoveredDocument = {
  path: "specs/security-baseline.md",
  folder_type: "specs",
  tokens: 139,
  used_by_agents: 4,
};

function renderDrawer(attached: boolean) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ContextPreviewDrawer repoId="r1" doc={DOC} attached={attached} onClose={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

describe("Context Preview drawer (T26)", () => {
  it("shows rendered markdown, type badge, token count, 'Used by N agents', and an 'Attached' chip when attached", () => {
    mockContent = {
      data: {
        path: DOC.path,
        content: "# Security\n\nNo secrets in **logs**.",
        tokens: 139,
        folder_type: "specs",
      },
      isLoading: false,
      isError: false,
    };
    renderDrawer(true);

    // Full path title.
    expect(screen.getByText("specs/security-baseline.md")).toBeInTheDocument();
    // Folder-type badge.
    expect(screen.getByText("specs")).toBeInTheDocument();
    // Token count + used-by count.
    expect(screen.getByText("139 tokens")).toBeInTheDocument();
    expect(screen.getByText("Used by 4 agents")).toBeInTheDocument();
    // Attached chip present when attached.
    expect(screen.getByText("Attached")).toBeInTheDocument();
    // Rendered markdown (heading becomes an <h1>).
    expect(screen.getByRole("heading", { name: "Security" })).toBeInTheDocument();
  });

  it("omits the 'Attached' chip when the doc is not attached", () => {
    mockContent = {
      data: { path: DOC.path, content: "body", tokens: 139, folder_type: "specs" },
      isLoading: false,
      isError: false,
    };
    renderDrawer(false);
    expect(screen.queryByText("Attached")).not.toBeInTheDocument();
  });
});
