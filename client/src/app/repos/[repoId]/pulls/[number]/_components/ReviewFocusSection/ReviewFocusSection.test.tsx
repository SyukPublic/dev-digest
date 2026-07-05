import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

const messages = {
  reviewFocus: { title: "Review focus — read these first" },
};

// --- Mutable stubs. The section reads the brief (focus list) + repo-context +
//     pull detail (repo/sha for the github blob links). ---
let mockBrief: { data: unknown; isLoading: boolean } = { data: null, isLoading: false };

vi.mock("@/lib/hooks/brief", () => ({
  useBrief: () => mockBrief,
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/app" } }),
}));
vi.mock("@/lib/hooks/core", () => ({
  usePullDetail: () => ({ data: { head_sha: "abc123" } }),
}));

import { ReviewFocusSection } from "./ReviewFocusSection";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockBrief = { data: null, isLoading: false };
});

const BRIEF = {
  pr_id: "pr1",
  generated_at: "2026-07-05T00:00:00Z",
  what: "w",
  why: "y",
  risk_level: "high",
  risks: [],
  review_focus: [
    { path: "src/config.ts", line: 12, reason: "live Stripe key committed in plaintext" },
    { path: "src/users.ts", line: 88, reason: "N+1 query under the new limiter" },
    { path: "src/mw.ts", line: null, reason: "whole-file: new middleware ordering" },
  ],
};

function renderSection(prId = "pr1") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      <ReviewFocusSection prId={prId} />
    </NextIntlClientProvider>,
  );
}

describe("ReviewFocusSection", () => {
  // T24 → AC-2 → test_review_focus_section
  it("renders an ordered list of review_focus[] with a count badge and file:line + reason per item", () => {
    mockBrief = { data: BRIEF, isLoading: false };

    renderSection();

    // Heading.
    expect(screen.getByText("Review focus — read these first")).toBeInTheDocument();

    // Count badge = item count (3). It sits in the header (its own element).
    expect(screen.getByText("3")).toBeInTheDocument();

    // An ordered list.
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);

    // Each item: file:line link + a one-line reason (rendered as data).
    expect(screen.getByText("src/config.ts:12")).toBeInTheDocument();
    expect(screen.getByText("live Stripe key committed in plaintext")).toBeInTheDocument();
    expect(screen.getByText("src/users.ts:88")).toBeInTheDocument();
    expect(screen.getByText("N+1 query under the new limiter")).toBeInTheDocument();

    // A whole-file item (no line) renders the bare path (no :line suffix).
    expect(screen.getByText("src/mw.ts")).toBeInTheDocument();
  });

  // T13 → AC-7, AC-8 → test_review_focus_framed
  it("renders the focus list inside a framed container (card frame/background) when items exist", () => {
    mockBrief = { data: BRIEF, isLoading: false };
    renderSection();

    // The list is the framed container: border + rounded + elevated background,
    // matching the Description box so the section reads as a sibling section.
    const list = screen.getByRole("list");
    expect(list).toHaveStyle({ border: "1px solid var(--border)" });
    expect(list).toHaveStyle({ background: "var(--bg-elevated)" });
    expect(list).toHaveStyle({ borderRadius: "8px" });
  });

  // T25 (section side) → AC-18, AC-21 → test_brief_a11y_and_link_safety
  it("links each file:line to a safe https github blob URL (new tab, noopener)", () => {
    mockBrief = { data: BRIEF, isLoading: false };

    renderSection();

    const link = screen.getByRole("link", { name: "src/config.ts:12" });
    const href = link.getAttribute("href") ?? "";
    // Safe protocol only — never javascript:.
    expect(href.startsWith("https://github.com/")).toBe(true);
    expect(href).not.toMatch(/^javascript:/i);
    // Line pinned to the PR head sha.
    expect(href).toContain("/blob/abc123/");
    expect(href).toContain("#L12");
    // New tab, hardened.
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders nothing when there is no brief or the focus list is empty", () => {
    mockBrief = { data: { ...BRIEF, review_focus: [] }, isLoading: false };
    const { container } = renderSection();
    expect(container.firstChild).toBeNull();

    cleanup();

    mockBrief = { data: null, isLoading: false };
    const { container: c2 } = renderSection();
    expect(c2.firstChild).toBeNull();
  });

  it("renders nothing while the brief is loading", () => {
    mockBrief = { data: undefined, isLoading: true };
    const { container } = renderSection();
    expect(container.firstChild).toBeNull();
  });
});
