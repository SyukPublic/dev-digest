import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import shell from "../../../../../../../../messages/en/shell.json";

// --- Mutable hook fixtures (repo convention: mock the hook modules, not MSW) ---
let mockSmartDiff: { data: unknown; isLoading: boolean } = { data: undefined, isLoading: false };
let mockReviews: { data: unknown } = { data: undefined };
let mockPull: { data: unknown } = { data: undefined };

vi.mock("@/lib/hooks/reviews", () => ({
  usePrSmartDiff: () => mockSmartDiff,
  usePrReviews: () => mockReviews,
  // DiffTab (original-view path) consumes these comment hooks.
  usePrComments: () => ({ data: [] }),
  useCreatePrComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/hooks/core", () => ({
  usePullDetail: () => mockPull,
}));

import { SmartDiffViewer } from "./SmartDiffViewer";
import { DiffTab } from "../DiffTab/DiffTab";

// DiffTab pulls in the original DiffViewer path → mock its remaining hooks.
vi.mock("@/lib/toast", () => ({ notify: { error: vi.fn() } }));

// --- Fixtures: a smart-diff with all three roles, one file carrying findings ---
const SMART_DIFF = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "server/src/service.ts",
          pseudocode_summary: null,
          additions: 12,
          deletions: 3,
          finding_lines: [5, 6, 8],
        },
        {
          path: "server/src/util.ts",
          pseudocode_summary: null,
          additions: 4,
          deletions: 0,
          finding_lines: [],
        },
      ],
    },
    {
      role: "wiring",
      files: [
        { path: "next.config.ts", pseudocode_summary: null, additions: 2, deletions: 1, finding_lines: [] },
      ],
    },
    {
      role: "boilerplate",
      files: [
        { path: "pnpm-lock.yaml", pseudocode_summary: null, additions: 100, deletions: 50, finding_lines: [] },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 172, proposed_splits: [] },
};

const PULL = {
  files: [
    {
      path: "server/src/service.ts",
      additions: 12,
      deletions: 3,
      // 8 added lines so the patch renders new-lines 1..8 (findings on 5 and 8).
      patch:
        "@@ -1,3 +1,8 @@\n+const a = 1;\n+const b = 2;\n+const c = 3;\n+const d = 4;\n+const e = 5;\n+const f = 6;\n+const g = 7;\n+const h = 8;",
    },
    { path: "server/src/util.ts", additions: 4, deletions: 0, patch: "@@ -1,0 +1,1 @@\n+export const x = 1;" },
    { path: "next.config.ts", additions: 2, deletions: 1, patch: null },
    { path: "pnpm-lock.yaml", additions: 100, deletions: 50, patch: null },
  ],
};

const REVIEWS = [
  {
    id: "rev1",
    pr_id: "pr1",
    kind: "review",
    findings: [
      {
        id: "f1",
        review_id: "rev1",
        severity: "CRITICAL",
        category: "bug",
        title: "Boom",
        file: "server/src/service.ts",
        start_line: 5,
        end_line: 6,
        rationale: "Null deref on the happy path",
        confidence: 0.9,
        accepted_at: null,
        dismissed_at: null,
      },
      {
        id: "f2",
        review_id: "rev1",
        severity: "SUGGESTION",
        category: "style",
        title: "Nit",
        file: "server/src/service.ts",
        start_line: 8,
        end_line: 8,
        rationale: "Prefer a constant here",
        confidence: 0.6,
        accepted_at: null,
        dismissed_at: null,
      },
    ],
  },
];

function renderViewer(prId = "pr1") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell }}>
      <SmartDiffViewer prId={prId} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  // jsdom does not implement scrollIntoView — provide a spy so click-to-jump works.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockSmartDiff = { data: undefined, isLoading: false };
  mockReviews = { data: undefined };
  mockPull = { data: undefined };
});

describe("SmartDiffViewer", () => {
  it("renders groups in core→wiring→boilerplate order, boilerplate collapsed by default and expandable", () => {
    mockSmartDiff = { data: SMART_DIFF, isLoading: false };
    mockPull = { data: PULL };
    mockReviews = { data: REVIEWS };

    renderViewer();

    // All three group headers present, in order.
    const headers = screen.getAllByText(/Core logic|Wiring|Boilerplate/);
    expect(headers.map((h) => h.textContent)).toEqual(["Core logic", "Wiring", "Boilerplate"]);

    // Core/wiring expanded by default → their files render.
    expect(screen.getByText("server/src/service.ts")).toBeInTheDocument();
    expect(screen.getByText("next.config.ts")).toBeInTheDocument();

    // Boilerplate collapsed by default → its file is NOT rendered yet.
    expect(screen.queryByText("pnpm-lock.yaml")).not.toBeInTheDocument();

    // Expand boilerplate via its chevron toggle.
    const boilerplateToggle = screen.getByRole("button", { name: "Boilerplate" });
    fireEvent.click(boilerplateToggle);
    expect(screen.getByText("pnpm-lock.yaml")).toBeInTheDocument();
  });

  it("places the badge before the +N −N stat and the red dot after the filename; neither on a clean file", () => {
    mockSmartDiff = { data: SMART_DIFF, isLoading: false };
    mockPull = { data: PULL };
    mockReviews = { data: REVIEWS };

    renderViewer();

    // The file with findings carries the badge (built from severity tally:
    // CRITICAL + SUGGESTION → 2 findings).
    const badge = screen.getByRole("button", { name: /2 findings/i });
    expect(badge).toBeInTheDocument();

    // Exactly one finding dot (server/src/service.ts), util.ts has none.
    expect(screen.getAllByTestId("finding-dot")).toHaveLength(1);
    const dot = screen.getByTestId("finding-dot");

    // Header DOM order: filename → dot → badge → +N −N stat.
    const header = badge.parentElement as HTMLElement;
    const filename = within(header).getByText("server/src/service.ts");
    const stat = within(header).getByText("+12");
    const order = (node: Node) =>
      Array.from(header.childNodes).findIndex((c) => c === node || c.contains(node));
    // Dot sits AFTER the filename (design shows `path ●`).
    expect(order(dot)).toBeGreaterThan(order(filename));
    // Badge sits immediately LEFT of (before) the +N −N stat.
    expect(order(badge)).toBeLessThan(order(stat));
    expect(order(dot)).toBeLessThan(order(badge));
  });

  it("renders an inline 'blocker' tag on the CRITICAL finding's start line when the file is expanded, leaving the header badge intact", () => {
    mockSmartDiff = { data: SMART_DIFF, isLoading: false };
    mockPull = { data: PULL };
    mockReviews = { data: REVIEWS };

    renderViewer();

    // Header count badge stays unchanged (R1 affordance is additive, not replaced).
    expect(screen.getByRole("button", { name: /2 findings/i })).toBeInTheDocument();

    // No inline tag until the file body is expanded.
    expect(screen.queryByText("blocker")).not.toBeInTheDocument();

    // Expand the file carrying the CRITICAL finding (start_line 5 in its patch).
    fireEvent.click(screen.getByText("server/src/service.ts"));

    // One inline severity tag with the design's vocabulary ("blocker" for CRITICAL).
    const tags = screen.getAllByText("blocker");
    expect(tags).toHaveLength(1);
    expect(tags[0]).toBeInTheDocument();
  });

  it("clicking the inline 'blocker' tag opens a popover scoped to that line's finding only", () => {
    mockSmartDiff = { data: SMART_DIFF, isLoading: false };
    mockPull = { data: PULL };
    mockReviews = { data: REVIEWS };

    renderViewer();

    // Expand the file so its inline tags render (CRITICAL on line 5, SUGGESTION on 8).
    fireEvent.click(screen.getByText("server/src/service.ts"));

    // The inline tag is a clickable button named by its severity word.
    const blockerTag = screen.getByRole("button", { name: "blocker" });
    fireEvent.click(blockerTag);

    const dialog = screen.getByRole("dialog", { name: "Findings" });
    // Scoped to line 5's finding ("Boom"), NOT the line-8 suggestion ("Nit").
    expect(within(dialog).getByText("Boom")).toBeInTheDocument();
    expect(within(dialog).queryByText("Nit")).not.toBeInTheDocument();
  });

  it("clicking the inline 'suggestion' tag opens a popover scoped to that line's finding only", () => {
    mockSmartDiff = { data: SMART_DIFF, isLoading: false };
    mockPull = { data: PULL };
    mockReviews = { data: REVIEWS };

    renderViewer();

    fireEvent.click(screen.getByText("server/src/service.ts"));

    const suggestionTag = screen.getByRole("button", { name: "suggestion" });
    fireEvent.click(suggestionTag);

    const dialog = screen.getByRole("dialog", { name: "Findings" });
    // Scoped to line 8's finding ("Nit"), NOT the line-5 critical ("Boom").
    expect(within(dialog).getByText("Nit")).toBeInTheDocument();
    expect(within(dialog).queryByText("Boom")).not.toBeInTheDocument();
  });

  it("opens the findings popover on header-badge click, listing ALL the file's findings", () => {
    mockSmartDiff = { data: SMART_DIFF, isLoading: false };
    mockPull = { data: PULL };
    mockReviews = { data: REVIEWS };

    renderViewer();

    const badge = screen.getByRole("button", { name: /2 findings/i });
    // No popover until the badge is clicked.
    expect(screen.queryByRole("dialog", { name: "Findings" })).not.toBeInTheDocument();

    fireEvent.click(badge);

    const dialog = screen.getByRole("dialog", { name: "Findings" });
    // Header badge is scoped to ALL the file's findings (unchanged behavior).
    expect(within(dialog).getByText("Boom")).toBeInTheDocument();
    expect(within(dialog).getByText("Null deref on the happy path")).toBeInTheDocument();
    expect(within(dialog).getByText("Nit")).toBeInTheDocument();
  });

  it("picking a finding in the popover scrolls its line into view and closes the popover", async () => {
    mockSmartDiff = { data: SMART_DIFF, isLoading: false };
    mockPull = { data: PULL };
    mockReviews = { data: REVIEWS };

    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView");
    renderViewer();

    fireEvent.click(screen.getByRole("button", { name: /2 findings/i }));
    const dialog = screen.getByRole("dialog", { name: "Findings" });

    // Pick the finding (its preview row is a button inside the popover).
    fireEvent.click(within(dialog).getByText("Boom"));

    await vi.waitFor(() => expect(scrollSpy).toHaveBeenCalled());
    expect(screen.queryByRole("dialog", { name: "Findings" })).not.toBeInTheDocument();
  });

  it("opens the findings popover for a binary file (null patch) that still has findings", () => {
    const binarySmartDiff = {
      groups: [
        {
          role: "core",
          files: [
            { path: "server/src/native.node", pseudocode_summary: null, additions: 0, deletions: 0, finding_lines: [3] },
          ],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
    };
    const binaryReviews = [
      {
        id: "rev1",
        pr_id: "pr1",
        kind: "review",
        findings: [
          {
            id: "fb",
            review_id: "rev1",
            severity: "WARNING",
            category: "security",
            title: "Opaque binary changed",
            file: "server/src/native.node",
            start_line: 3,
            end_line: 3,
            rationale: "Binary blob has no reviewable diff",
            confidence: 0.7,
            accepted_at: null,
            dismissed_at: null,
          },
        ],
      },
    ];
    mockSmartDiff = { data: binarySmartDiff, isLoading: false };
    mockPull = { data: { files: [{ path: "server/src/native.node", additions: 0, deletions: 0, patch: null }] } };
    mockReviews = { data: binaryReviews };

    renderViewer();

    // Badge + dot render even though the file has no patch (empty body).
    expect(screen.getAllByTestId("finding-dot")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /1 findings/i }));

    const dialog = screen.getByRole("dialog", { name: "Findings" });
    expect(within(dialog).getByText("Opaque binary changed")).toBeInTheDocument();
    expect(within(dialog).getByText("Binary blob has no reviewable diff")).toBeInTheDocument();
  });

  it("renders the noSmartDiff empty state when there are no present groups", () => {
    mockSmartDiff = { data: { groups: [], split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] } }, isLoading: false };
    mockPull = { data: { files: [] } };
    mockReviews = { data: [] };

    renderViewer();

    expect(screen.getByText("Smart diff not available yet.")).toBeInTheDocument();
  });
});

// --- DiffTab toggle: swaps SmartDiffViewer ↔ DiffViewer ---
function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell }}>
      <DiffTab prId="pr1" filesCount={1} files={[{ path: "a.ts", additions: 1, deletions: 0, patch: "@@ -1 +1 @@\n+x" }]} />
    </NextIntlClientProvider>,
  );
}

describe("DiffTab smart/original toggle", () => {
  it("defaults to smart order and toggles to the original flat DiffViewer", () => {
    mockSmartDiff = { data: SMART_DIFF, isLoading: false };
    mockPull = { data: PULL };
    mockReviews = { data: REVIEWS };

    renderTab();

    // Default = smart → SmartDiffViewer groups render (Core logic header present).
    expect(screen.getByText("Core logic")).toBeInTheDocument();
    // The original-view file (a.ts) is not in the smart fixture.
    expect(screen.queryByText("a.ts")).not.toBeInTheDocument();

    // Toggle to Original order → flat DiffViewer renders the passed files.
    fireEvent.click(screen.getByRole("button", { name: "Original order" }));
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.queryByText("Core logic")).not.toBeInTheDocument();
  });
});
