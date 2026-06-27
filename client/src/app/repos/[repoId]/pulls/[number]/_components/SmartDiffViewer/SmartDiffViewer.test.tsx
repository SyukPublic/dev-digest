import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import shell from "../../../../../../../../messages/en/shell.json";
import prReview from "../../../../../../../../messages/en/prReview.json";

// --- Mutable hook fixtures (repo convention: mock the hook modules, not MSW) ---
let mockSmartDiff: { data: unknown; isLoading: boolean } = { data: undefined, isLoading: false };
let mockReviews: { data: unknown } = { data: undefined };
let mockPull: { data: unknown } = { data: undefined };

// Hoisted spy so the vi.mock factory below can close over it while still being
// lifted to module scope by Vitest's hoisting transform.
const mutateSpy = vi.hoisted(() => vi.fn());

vi.mock("@/lib/hooks/reviews", () => ({
  usePrSmartDiff: () => mockSmartDiff,
  usePrReviews: () => mockReviews,
  // DiffTab (original-view path) consumes these comment hooks.
  usePrComments: () => ({ data: [] }),
  useCreatePrComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  // Phase-2 addition: SmartDiffViewer/FileRow calls useFindingAction() to wire
  // Accept/Dismiss buttons inside the inline-tag card-mode popover.
  useFindingAction: () => ({ mutate: mutateSpy, isPending: false, variables: undefined }),
}));

vi.mock("@/lib/hooks/core", () => ({
  usePullDetail: () => mockPull,
}));

// Phase-2 addition: SmartDiffViewer now calls useActiveRepo() to source
// repoFullName for FindingCard's GitHub deep-link. Provide a minimal stub so
// tests don't need a live RepoProvider (which requires Next.js pathname context).
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "owner/repo" } }),
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

// Base REVIEWS fixture: f1 (CRITICAL, line 5) + f2 (SUGGESTION, line 8).
// f1 includes a `suggestion` so the SUGGESTED FIX block can be asserted.
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
        suggestion: "Add a null check before dereferencing.",
        confidence: 0.9,
        kind: "finding",
        trifecta_components: null,
        evidence: null,
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
        suggestion: null,
        confidence: 0.6,
        kind: "finding",
        trifecta_components: null,
        evidence: null,
        accepted_at: null,
        dismissed_at: null,
      },
    ],
  },
];

// Multi-card fixture: TWO findings share start_line 5 (CRITICAL + WARNING).
// Used to assert worst-first stacking and primary-only expansion.
const REVIEWS_MULTI = [
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
        suggestion: "Add a null check before dereferencing.",
        confidence: 0.9,
        kind: "finding",
        trifecta_components: null,
        evidence: null,
        accepted_at: null,
        dismissed_at: null,
      },
      {
        // Same start_line as f1 — both cards should appear in the popover.
        id: "f3",
        review_id: "rev1",
        severity: "WARNING",
        category: "security",
        title: "WarningCard",
        file: "server/src/service.ts",
        start_line: 5,
        end_line: 5,
        rationale: "Potential injection vector",
        suggestion: null,
        confidence: 0.7,
        kind: "finding",
        trifecta_components: null,
        evidence: null,
        accepted_at: null,
        dismissed_at: null,
      },
    ],
  },
];

// Smart-diff fixture whose finding_lines includes line 5 only (for REVIEWS_MULTI).
const SMART_DIFF_MULTI = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "server/src/service.ts",
          pseudocode_summary: null,
          additions: 12,
          deletions: 3,
          finding_lines: [5, 6],
        },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 172, proposed_splits: [] },
};

function renderViewer(prId = "pr1") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell, prReview }}>
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

  // --- Card-mode (inline-tag) popover tests ---

  // Unit under test: FileRow's inline-tag click path renders FindingCards.
  // Input: SMART_DIFF + PULL + REVIEWS fixture; clicking the "blocker" inline tag.
  // Stubs: useFindingAction returns { mutate: mutateSpy, isPending: false }.
  // Expected: dialog opens with rationale text + Accept/Dismiss buttons; the
  //   simple header (visible "Findings" title + a "Close" button) is KEPT, but the
  //   SeverityFilter chips are NOT rendered (card-mode); scoped to line 5 ("Boom"),
  //   not line 8 ("Nit").
  it("clicking the inline 'blocker' tag opens a full-card popover (simple header + close, no filter chips, shows rationale + Accept/Dismiss)", () => {
    mockSmartDiff = { data: SMART_DIFF, isLoading: false };
    mockPull = { data: PULL };
    mockReviews = { data: REVIEWS };

    renderViewer();

    // Expand the file so its inline tags render (CRITICAL on line 5, SUGGESTION on 8).
    fireEvent.click(screen.getByText("server/src/service.ts"));

    // The inline tag is a clickable button named by its severity word.
    const blockerTag = screen.getByRole("button", { name: "blocker" });
    fireEvent.click(blockerTag);

    // Dialog is found by its aria-label="Findings" (always set, even in card-mode
    // where the visible "Findings" header span is absent).
    const dialog = screen.getByRole("dialog", { name: "Findings" });

    // --- Card content assertions ---
    // Rationale markdown text is visible (FindingCard body is expanded for the primary).
    expect(within(dialog).getByText("Null deref on the happy path")).toBeInTheDocument();

    // Accept and Dismiss buttons are rendered inside the expanded card body.
    expect(within(dialog).getByRole("button", { name: /accept/i })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /dismiss/i })).toBeInTheDocument();

    // --- Card-mode chrome assertions ---
    // The simple header is KEPT in card-mode: a visible "Findings" title span and
    // a "Close" (X) button (closeLabel = t("diffViewer.findingsClose") = "Close").
    expect(within(dialog).getByText("Findings")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeInTheDocument();
    // But the SeverityFilter chips (list-mode only) are NOT rendered. Each chip is a
    // button whose accessible name matches "Show/Hide <sev> findings (N)".
    expect(
      within(dialog).queryByRole("button", { name: /findings \(\d+\)/i }),
    ).not.toBeInTheDocument();

    // --- Scoping: shows line 5's finding ("Boom"), not line 8's ("Nit") ---
    expect(within(dialog).getByText("Boom")).toBeInTheDocument();
    expect(within(dialog).queryByText("Nit")).not.toBeInTheDocument();
  });

  // Unit under test: inline-tag card popover for the SUGGESTION-severity tag.
  // Input: clicking the "suggestion" inline tag on line 8.
  // Expected: dialog shows "Nit" (line 8) but not "Boom" (line 5).
  it("clicking the inline 'suggestion' tag opens a card-mode popover scoped to that line's finding only", () => {
    mockSmartDiff = { data: SMART_DIFF, isLoading: false };
    mockPull = { data: PULL };
    mockReviews = { data: REVIEWS };

    renderViewer();

    fireEvent.click(screen.getByText("server/src/service.ts"));

    const suggestionTag = screen.getByRole("button", { name: "suggestion" });
    fireEvent.click(suggestionTag);

    // Dialog is accessible via aria-label regardless of card-mode.
    const dialog = screen.getByRole("dialog", { name: "Findings" });

    // Scoped to line 8's finding ("Nit"), NOT the line-5 critical ("Boom").
    expect(within(dialog).getByText("Nit")).toBeInTheDocument();
    expect(within(dialog).queryByText("Boom")).not.toBeInTheDocument();

    // Card actions visible for the expanded (primary) card.
    expect(within(dialog).getByRole("button", { name: /accept/i })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /dismiss/i })).toBeInTheDocument();
  });

  // Unit under test: FindingCard renders SUGGESTED FIX block when suggestion is present.
  // Input: f1 has suggestion = "Add a null check before dereferencing." (see REVIEWS fixture).
  // Expected: "Suggested fix" label (t("finding.suggestedFix")) + suggestion body text visible.
  it("renders the SUGGESTED FIX block when the finding has a suggestion", () => {
    mockSmartDiff = { data: SMART_DIFF, isLoading: false };
    mockPull = { data: PULL };
    mockReviews = { data: REVIEWS };

    renderViewer();
    fireEvent.click(screen.getByText("server/src/service.ts"));
    fireEvent.click(screen.getByRole("button", { name: "blocker" }));

    const dialog = screen.getByRole("dialog", { name: "Findings" });

    // "Suggested fix" is the t("finding.suggestedFix") label rendered above the suggestion body.
    expect(within(dialog).getByText("Suggested fix")).toBeInTheDocument();
    // The suggestion body text itself.
    expect(within(dialog).getByText("Add a null check before dereferencing.")).toBeInTheDocument();
  });

  // Unit under test: clicking Accept calls useFindingAction().mutate with correct args.
  // Input: click the "blocker" inline tag (f1, CRITICAL, line 5), then click Accept.
  // Stubs: mutateSpy captures the call args.
  // Expected: mutateSpy called with { findingId: "f1", action: "accept", prId: "pr1" }.
  it("Accept fires useFindingAction mutate with findingId, action='accept', prId", () => {
    mockSmartDiff = { data: SMART_DIFF, isLoading: false };
    mockPull = { data: PULL };
    mockReviews = { data: REVIEWS };

    renderViewer();
    fireEvent.click(screen.getByText("server/src/service.ts"));
    fireEvent.click(screen.getByRole("button", { name: "blocker" }));

    const dialog = screen.getByRole("dialog", { name: "Findings" });
    fireEvent.click(within(dialog).getByRole("button", { name: /accept/i }));

    expect(mutateSpy).toHaveBeenCalledWith({ findingId: "f1", action: "accept", prId: "pr1" });
  });

  // Unit under test: clicking Dismiss calls useFindingAction().mutate with correct args.
  // Input: click the "blocker" inline tag (f1), then click Dismiss.
  // Expected: mutateSpy called with { findingId: "f1", action: "dismiss", prId: "pr1" }.
  it("Dismiss fires useFindingAction mutate with findingId, action='dismiss', prId", () => {
    mockSmartDiff = { data: SMART_DIFF, isLoading: false };
    mockPull = { data: PULL };
    mockReviews = { data: REVIEWS };

    renderViewer();
    fireEvent.click(screen.getByText("server/src/service.ts"));
    fireEvent.click(screen.getByRole("button", { name: "blocker" }));

    const dialog = screen.getByRole("dialog", { name: "Findings" });
    fireEvent.click(within(dialog).getByRole("button", { name: /dismiss/i }));

    expect(mutateSpy).toHaveBeenCalledWith({ findingId: "f1", action: "dismiss", prId: "pr1" });
  });

  // Unit under test: multiple findings on the same start_line → all cards stacked,
  //   only the worst-severity (CRITICAL = primary) card is expanded, others collapsed.
  // Input: REVIEWS_MULTI has f1 (CRITICAL, start_line 5) + f3 (WARNING, start_line 5).
  // Stubs: standard mocks + REVIEWS_MULTI.
  // Expected:
  //   - Both card titles visible in the dialog.
  //   - Primary (CRITICAL/f1) expanded: its rationale + Accept button visible.
  //   - Secondary (WARNING/f3) collapsed: its rationale NOT visible.
  //   - Ordering: CRITICAL card appears before WARNING card in DOM (worst-first).
  it("multiple findings on one line: both cards render, only the CRITICAL (primary) card is expanded by default", () => {
    mockSmartDiff = { data: SMART_DIFF_MULTI, isLoading: false };
    mockPull = { data: PULL };
    mockReviews = { data: REVIEWS_MULTI };

    renderViewer();
    fireEvent.click(screen.getByText("server/src/service.ts"));
    fireEvent.click(screen.getByRole("button", { name: "blocker" }));

    const dialog = screen.getByRole("dialog", { name: "Findings" });

    // Both card titles visible (both cards render their header regardless of expansion).
    expect(within(dialog).getByText("Boom")).toBeInTheDocument();
    expect(within(dialog).getByText("WarningCard")).toBeInTheDocument();

    // Primary (CRITICAL/f1) is expanded → its rationale body text is visible.
    expect(within(dialog).getByText("Null deref on the happy path")).toBeInTheDocument();
    // Primary's Accept button is accessible (body expanded).
    expect(within(dialog).getByRole("button", { name: /accept/i })).toBeInTheDocument();

    // Secondary (WARNING/f3) is collapsed → its rationale body text is NOT visible.
    expect(within(dialog).queryByText("Potential injection vector")).not.toBeInTheDocument();

    // Worst-first ordering: CRITICAL card's title appears before WARNING card's title in DOM.
    const boomEl = within(dialog).getByText("Boom");
    const warningEl = within(dialog).getByText("WarningCard");
    expect(
      boomEl.compareDocumentPosition(warningEl) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // Unit under test: clicking inside the card (Accept button) does NOT close the popover.
  // Input: open the card popover, click Accept.
  // Expected: dialog is still present after the click (stopPropagation on the panel
  //   prevents the outside-click mousedown handler from firing on button clicks).
  it("clicking the Accept button inside the card does not close the popover", () => {
    mockSmartDiff = { data: SMART_DIFF, isLoading: false };
    mockPull = { data: PULL };
    mockReviews = { data: REVIEWS };

    renderViewer();
    fireEvent.click(screen.getByText("server/src/service.ts"));
    fireEvent.click(screen.getByRole("button", { name: "blocker" }));

    const dialog = screen.getByRole("dialog", { name: "Findings" });

    // Click the Accept button inside the card.
    fireEvent.click(within(dialog).getByRole("button", { name: /accept/i }));

    // Popover is still open (stopPropagation on the panel prevents outside-click close).
    expect(screen.getByRole("dialog", { name: "Findings" })).toBeInTheDocument();
  });

  // Unit under test: the card-mode header "Close" (X) button closes the popover.
  // Input: open the card popover, click the "Close" button in the kept header.
  // Expected: the dialog is removed (onClose → closePopover).
  it("clicking the card-mode header Close button closes the popover", () => {
    mockSmartDiff = { data: SMART_DIFF, isLoading: false };
    mockPull = { data: PULL };
    mockReviews = { data: REVIEWS };

    renderViewer();
    fireEvent.click(screen.getByText("server/src/service.ts"));
    fireEvent.click(screen.getByRole("button", { name: "blocker" }));

    const dialog = screen.getByRole("dialog", { name: "Findings" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog", { name: "Findings" })).not.toBeInTheDocument();
  });

  // --- Header-badge path (UNCHANGED from before Phase 2) ---

  // Unit under test: header badge click opens the list-mode popover (all file findings).
  // Input: click the "2 findings" badge button.
  // Expected: dialog has "Findings" visible text (list-mode chrome), shows Boom + Nit.
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
    // List-mode chrome: the visible "Findings" header title is rendered.
    expect(within(dialog).getByText("Findings")).toBeInTheDocument();
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
            suggestion: null,
            confidence: 0.7,
            kind: "finding",
            trifecta_components: null,
            evidence: null,
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
    <NextIntlClientProvider locale="en" messages={{ shell, prReview }}>
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
