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
  { path: "src/a.ts", additions: 10, deletions: 0, patch: "@@ -1,0 +1,1 @@\n+const a = 1;" },
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

// T15 → AC-12 → test_difftab_flat_no_indiff
describe("DiffTab — flat DiffViewer receives no in-diff deep-link handling", () => {
  it("renders the flat DiffViewer (prId=null → smart branch off) even when file/line params are present; the flat file body renders with no jump anchors", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ shell: messages }}>
        <DiffTab
          prId={null}
          filesCount={FILES.length}
          files={FILES}
          deepLinkFile="src/a.ts"
          deepLinkLine="1-1"
        />
      </NextIntlClientProvider>,
    );

    // The flat DiffViewer renders the passed file directly (prId=null forces it).
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    // The SmartDiffViewer smart-diff group chrome is NOT present (flat view).
    expect(screen.queryByText("Core logic")).not.toBeInTheDocument();
    // No deep-link line anchors exist anywhere — in-diff handling is SmartDiffViewer-only.
    expect(document.querySelectorAll("[data-deep-link-line]")).toHaveLength(0);
  });
});
