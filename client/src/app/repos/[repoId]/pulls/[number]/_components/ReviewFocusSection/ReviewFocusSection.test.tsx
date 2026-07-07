import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

const messages = {
  reviewFocus: { title: "Review focus — read these first" },
};

// --- Mutable stubs. The section reads the brief (focus list) + repo-context +
//     pull detail (repo/sha for the github blob links AND files for the in-diff
//     decision). ---
let mockBrief: { data: unknown; isLoading: boolean } = { data: null, isLoading: false };
let mockPullData: unknown = { head_sha: "abc123" };

vi.mock("@/lib/hooks/brief", () => ({
  useBrief: () => mockBrief,
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/app" } }),
}));
vi.mock("@/lib/hooks/core", () => ({
  usePullDetail: () => ({ data: mockPullData }),
}));

const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1", number: "7" }),
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => new URLSearchParams("tab=overview"),
}));

import { ReviewFocusSection } from "./ReviewFocusSection";

// A changed file rendering new-side lines 1..100 so a review-focus `line` inside
// resolves to an in-diff jump; other paths / patch-less files fall back.
const PULL_WITH_FILES = {
  head_sha: "abc123",
  files: [
    {
      path: "src/config.ts",
      additions: 100,
      deletions: 0,
      // A single hunk spanning new-side lines 1..100.
      patch: "@@ -1,0 +1,100 @@\n" + Array.from({ length: 100 }, (_, i) => `+line ${i + 1}`).join("\n"),
    },
    { path: "src/mw.ts", additions: 3, deletions: 0, patch: "@@ -1,0 +1,3 @@\n+a\n+b\n+c" },
  ],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockBrief = { data: null, isLoading: false };
  mockPullData = { head_sha: "abc123" };
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

  // ---- Phase 3: REVIEW FOCUS in-diff deep-links vs github fallback ----

  // T7 → AC-2 → test_focus_indiff_line
  it("renders an INTERNAL app-route link (not github.com) for an item whose path+line match the diff", () => {
    mockBrief = { data: BRIEF, isLoading: false };
    mockPullData = PULL_WITH_FILES;

    renderSection();

    // src/config.ts:12 → path is a diff file, line 12 is within new-side hunks.
    const link = screen.getByRole("link", { name: "src/config.ts:12" });
    const href = link.getAttribute("href") ?? "";
    expect(href.startsWith("/repos/r1/pulls/7?")).toBe(true);
    expect(href).not.toContain("github.com");
    const sp = new URLSearchParams(href.split("?")[1]);
    expect(sp.get("tab")).toBe("diff");
    expect(sp.get("file")).toBe("src/config.ts");
    expect(sp.get("line")).toBe("12");

    // A plain left-click navigates in-app via the router (app route only).
    fireEvent.click(link, { button: 0 });
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace.mock.calls[0]![0]).toMatch(/^\/repos\/r1\/pulls\/7\?/);
  });

  // T8 → AC-4, AC-5 → test_focus_pathonly_and_fallback
  it("renders a FILE-LEVEL internal link for a no-line item in the diff, and github fallback for out-of-diff / non-intersecting items", () => {
    mockBrief = {
      data: {
        ...BRIEF,
        review_focus: [
          // Whole-file item (line null) whose path IS a diff file → file-level jump.
          { path: "src/mw.ts", line: null, reason: "whole-file focus" },
          // Path IS a diff file but line 500 is outside the rendered hunks → fallback.
          { path: "src/config.ts", line: 500, reason: "stale line" },
          // Out-of-diff path → fallback.
          { path: "src/not-in-diff.ts", line: 4, reason: "caller" },
        ],
      },
      isLoading: false,
    };
    mockPullData = PULL_WITH_FILES;

    renderSection();

    // File-level internal link — no line param.
    const fileLevel = screen.getByRole("link", { name: "src/mw.ts" });
    const fileHref = fileLevel.getAttribute("href") ?? "";
    const fileSp = new URLSearchParams(fileHref.split("?")[1]);
    expect(fileHref.startsWith("/repos/r1/pulls/7?")).toBe(true);
    expect(fileSp.get("file")).toBe("src/mw.ts");
    expect(fileSp.has("line")).toBe(false);

    // Non-intersecting + out-of-diff → github.com https blob fallback.
    for (const refLabel of ["src/config.ts:500", "src/not-in-diff.ts:4"]) {
      const link = screen.getByRole("link", { name: refLabel });
      const href = link.getAttribute("href") ?? "";
      expect(href.startsWith("https://github.com/")).toBe(true);
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });
});
