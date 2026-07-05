import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

// --- Inline `brief`-namespace messages (Phase 8 owns messages/**; we pass the
//     keys this card references directly so the test is decoupled from the JSON.
//     The final report lists every referenced key for Phase 8 to add). ---
const messages = {
  prBrief: { title: "PR Brief" },
  verdict: {
    request_changes: "Request changes",
    approve: "Approve",
    comment: "Comment",
  },
  findingsBlockers: "{findings} findings · {blockers} blockers",
  prScore: "PR Score",
  scoreOf: "Score {score} of 100",
  scoreUnavailable: "Score not available",
  regenerate: "Regenerate brief",
  generating: "Generating…",
  generateFailed: "Could not regenerate the brief. Try again.",
  briefUpdated: "Brief updated",
  outdated: "Outdated",
  outdatedTooltip:
    "Editing the linked issue or attached specs is not auto-detected — Regenerate to refresh.",
  riskLevelLabel: "Risk level",
  riskLevel: { high: "High risk", medium: "Medium risk", low: "Low risk" },
  riskLevelTooltip: {
    high: "High risk",
    medium: "Medium risk",
    low: "Low risk",
  },
  info: {
    title: "How this is built",
    body: "The header is composed from the latest review (no extra AI call); the summary is the generated brief.",
  },
  empty: {
    body: "No brief yet. Generate one to summarize what changed and why.",
    cta: "Generate brief",
  },
  reviewFocus: { title: "Review focus — read these first" },
};

// --- Mutable stubs for the brief + reviews/runs hooks (repo convention: mock the
//     hook modules; INSIGHTS 2026-06-24). ---
const mockRegenMutate = vi.fn();
let mockBrief: { data: unknown; isLoading: boolean } = { data: null, isLoading: false };
let mockReviews: unknown[] = [];
let mockRuns: unknown[] = [];
let mockRegenPending = false;
let mockRegenError = false;
let mockRegenSuccess = false;

vi.mock("@/lib/hooks/brief", () => ({
  useBrief: () => mockBrief,
  useRegenerateBrief: () => ({
    mutate: mockRegenMutate,
    isPending: mockRegenPending,
    isError: mockRegenError,
    isSuccess: mockRegenSuccess,
  }),
}));

vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: () => ({ data: mockReviews }),
  usePrRuns: () => ({ data: mockRuns }),
}));

import { PrBriefCard } from "./PrBriefCard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockBrief = { data: null, isLoading: false };
  mockReviews = [];
  mockRuns = [];
  mockRegenPending = false;
  mockRegenError = false;
  mockRegenSuccess = false;
});

const BRIEF = {
  pr_id: "pr1",
  generated_at: "2026-07-05T00:00:00Z",
  what: "Adds a Stripe webhook handler behind the new rate limiter.",
  why: "Two blockers before merge: a committed secret key and an N+1 query.",
  risk_level: "high",
  risks: [],
  review_focus: [],
};

const REVIEW = {
  id: "rev1",
  pr_id: "pr1",
  agent_id: "a1",
  run_id: "run1",
  kind: "review",
  verdict: "request_changes",
  summary: "s",
  score: 61,
  model: "gpt",
  created_at: "2026-07-05T00:00:00Z",
  findings: [
    { id: "f1", severity: "CRITICAL", category: "security", title: "secret", file: "a.ts", start_line: 1, end_line: 1, rationale: "r", confidence: 0.9 },
    { id: "f2", severity: "CRITICAL", category: "bug", title: "n+1", file: "b.ts", start_line: 2, end_line: 2, rationale: "r", confidence: 0.9 },
    { id: "f3", severity: "WARNING", category: "style", title: "nit", file: "c.ts", start_line: 3, end_line: 3, rationale: "r", confidence: 0.5 },
  ],
};

const RUN = {
  run_id: "run1",
  agent_id: "a1",
  agent_name: "reviewer",
  provider: "openrouter",
  model: "gpt",
  status: "done",
  error: null,
  duration_ms: 1000,
  tokens_in: 8200,
  tokens_out: 1300,
  cost_usd: 0.014,
  findings_count: 3,
  grounding: null,
  ran_at: "2026-07-05T00:00:00Z",
  score: 61,
  blockers: 2,
};

function renderCard(prId = "pr1") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      <PrBriefCard prId={prId} />
    </NextIntlClientProvider>,
  );
}

describe("PrBriefCard", () => {
  // T17 → AC-6 → test_brief_card_body
  it("renders the brief body: what/why prose, a risk_level badge, and an info affordance", () => {
    mockBrief = { data: BRIEF, isLoading: false };

    renderCard();

    expect(screen.getByText("PR Brief")).toBeInTheDocument();
    expect(
      screen.getByText(/Adds a Stripe webhook handler/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Two blockers before merge/)).toBeInTheDocument();

    // Colour-coded risk_level badge — high, with its textual label (not colour
    // alone).
    expect(screen.getByText("High risk")).toBeInTheDocument();
    expect(screen.getByText("Risk level:")).toBeInTheDocument();

    // Info affordance — keyboard-operable expander (aria-expanded).
    const info = screen.getByRole("button", { name: /how this is built/i });
    expect(info).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(info);
    expect(info).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/composed from the latest review/i)).toBeInTheDocument();
  });

  // T18 → AC-7 → test_brief_card_header_composed
  it("composes the header from the latest review + its run", () => {
    mockBrief = { data: BRIEF, isLoading: false };
    mockReviews = [REVIEW];
    mockRuns = [RUN];

    renderCard();

    // Verdict badge (from review.verdict).
    expect(screen.getByText("Request changes")).toBeInTheDocument();
    // findings · blockers pill (3 findings, 2 CRITICAL).
    expect(screen.getByText("3 findings · 2 blockers")).toBeInTheDocument();
    // PR SCORE gauge with a TEXT EQUIVALENT (role img + aria-label).
    expect(screen.getByRole("img", { name: "Score 61 of 100" })).toBeInTheDocument();
    // Cost line: cost + tokens (formatCost/formatTokensTotal reuse).
    expect(screen.getByText(/\$0\.014/)).toBeInTheDocument();
    expect(screen.getByText(/9 500 tok/)).toBeInTheDocument();
  });

  it("renders header fields as — when there is no review", () => {
    mockBrief = { data: BRIEF, isLoading: false };
    mockReviews = [];
    mockRuns = [];

    renderCard();

    // No verdict text; the findings/blockers pill and gauge fall back to —.
    expect(screen.queryByText("Request changes")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /score/i })).not.toBeInTheDocument();
    expect(screen.getByText("Score not available")).toBeInTheDocument();
    // At least one em-dash placeholder is present (pill / verdict / gauge).
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("ignores a summary row and only composes from the latest kind==='review'", () => {
    mockBrief = { data: BRIEF, isLoading: false };
    // A summary row first (must be skipped) then the real review.
    mockReviews = [{ ...REVIEW, id: "sum", kind: "summary", verdict: "approve", score: 99 }, REVIEW];
    mockRuns = [RUN];

    renderCard();

    // The 'review' row wins, not the 'summary' row.
    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.queryByText("Approve")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Score 61 of 100" })).toBeInTheDocument();
  });

  // T19 → AC-8 → test_brief_card_empty_state
  it("shows the Generate empty body when no brief is stored, and makes no LLM call on open", () => {
    mockBrief = { data: null, isLoading: false };
    mockReviews = [REVIEW];
    mockRuns = [RUN];

    renderCard();

    // Empty body + Generate action.
    expect(screen.getByText(/No brief yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate brief/i })).toBeInTheDocument();

    // Opening the page must NOT trigger a generation.
    expect(mockRegenMutate).not.toHaveBeenCalled();

    // The composed header still renders review data independently of the missing
    // brief.
    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Score 61 of 100" })).toBeInTheDocument();
  });

  // T20 → AC-9 → test_brief_regenerate
  it("clicking Regenerate recomputes only the brief (never starts a review)", () => {
    mockBrief = { data: BRIEF, isLoading: false };
    mockReviews = [REVIEW];
    mockRuns = [RUN];

    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /regenerate brief/i }));

    expect(mockRegenMutate).toHaveBeenCalledOnce();
    expect(mockRegenMutate).toHaveBeenCalledWith("pr1");
  });

  it("clicking Generate from the empty state calls the brief mutation only", () => {
    mockBrief = { data: null, isLoading: false };

    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /generate brief/i }));

    expect(mockRegenMutate).toHaveBeenCalledOnce();
    expect(mockRegenMutate).toHaveBeenCalledWith("pr1");
  });

  // T21 → AC-10 → test_brief_generating_progress
  it("shows a progress affordance and disables Generate while pending", () => {
    mockBrief = { data: null, isLoading: false };
    mockRegenPending = true;

    renderCard();

    // The Generate control is disabled + busy while pending.
    const cta = screen.getByRole("button", { name: /generating/i });
    expect(cta).toBeDisabled();
    expect(cta).toHaveAttribute("aria-busy", "true");
    // aria-live announces the in-progress state.
    expect(screen.getByRole("status")).toHaveTextContent("Generating…");
  });

  // T22 → AC-14 → test_brief_outdated_badge
  it("shows the Outdated badge (icon + text) with the not-auto-flagged tooltip when is_stale", () => {
    mockBrief = { data: { ...BRIEF, is_stale: true }, isLoading: false };

    renderCard();

    expect(screen.getByText("Outdated")).toBeInTheDocument();
    expect(
      screen.getByTitle(/is not auto-detected/i),
    ).toBeInTheDocument();
  });

  it("shows no Outdated badge for a not-stale or legacy brief", () => {
    // Legacy record: no is_stale field at all → treated as not stale.
    mockBrief = { data: BRIEF, isLoading: false };

    renderCard();

    expect(screen.queryByText("Outdated")).not.toBeInTheDocument();
  });

  // T23 → AC-15 → test_brief_loading_state
  it("shows a loading state (not blank, not error) while the brief loads", () => {
    mockBrief = { data: undefined, isLoading: true };

    const { container } = renderCard();

    // Not blank: the card + header render; skeleton bars present.
    expect(screen.getByText("PR Brief")).toBeInTheDocument();
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
    // Not the empty state, not an error.
    expect(screen.queryByText(/No brief yet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // T25 (card side) → AC-18 → test_brief_a11y_and_link_safety
  it("announces regenerate failure via aria-live and surfaces a non-blocking error", () => {
    mockBrief = { data: BRIEF, isLoading: false };
    mockReviews = [REVIEW];
    mockRuns = [RUN];
    mockRegenError = true;

    renderCard();

    // Non-blocking inline error — the composed header is still present.
    expect(screen.getByRole("alert")).toHaveTextContent(/Could not regenerate/i);
    expect(screen.getByText("Request changes")).toBeInTheDocument();
    // aria-live announcement.
    expect(screen.getByRole("status")).toHaveTextContent(/Could not regenerate/i);
  });

  it("announces success via aria-live after a regenerate", () => {
    mockBrief = { data: BRIEF, isLoading: false };
    mockRegenSuccess = true;

    renderCard();

    expect(screen.getByRole("status")).toHaveTextContent("Brief updated");
  });

  it("shows a — cost line (never $0.00) when the run has no priced cost", () => {
    mockBrief = { data: BRIEF, isLoading: false };
    mockReviews = [REVIEW];
    mockRuns = [{ ...RUN, cost_usd: null }];

    renderCard();

    // No "$0.00" masquerading as free.
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });
});
