import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/shell.json";

// Mock the comment hooks DiffTab consumes — this slice only exercises the
// base-hint, which lives outside the comment/diff body. prId=null routes to the
// plain DiffViewer (the smart branch is gated on `smart && prId`).
vi.mock("@/lib/hooks/reviews", () => ({
  usePrComments: () => ({ data: [] }),
  useCreatePrComment: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

import { DiffTab } from "./DiffTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const FILES: PrFile[] = [
  { path: "src/a.ts", additions: 10, deletions: 0, patch: null },
];

function renderTab(base?: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: messages }}>
      <DiffTab prId={null} filesCount={FILES.length} files={FILES} base={base} />
    </NextIntlClientProvider>,
  );
}

describe("DiffTab — cumulative-diff base hint (Issue #2)", () => {
  it("renders the localized hint with the real base ref when base is present", () => {
    renderTab("main");

    // The visible string is interpolated from the shell.json message (not
    // hardcoded) and carries the actual base ref.
    expect(screen.getByText("Cumulative PR diff against main")).toBeInTheDocument();
  });

  it("interpolates a different base ref", () => {
    renderTab("release/2.0");

    expect(
      screen.getByText("Cumulative PR diff against release/2.0"),
    ).toBeInTheDocument();
  });

  it("renders no hint when base is absent", () => {
    renderTab(undefined);

    expect(screen.queryByText(/Cumulative PR diff against/i)).not.toBeInTheDocument();
  });
});
