import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/brief.json";

// --- Mutable stubs. Intent summary + scope lists stay on the standalone Intent
//     artifact (usePrIntent / useRecomputeIntent). RISK AREAS is now driven by the
//     Why+Risk BRIEF (useBrief) and its Regenerate (useRegenerateBrief). The single
//     Recompute button drives BOTH mutations. Repo/sha for the risk file links come
//     from repo-context + pull detail (like ReviewFocusSection). ---
const mockIntentMutate = vi.fn();
const mockIntentMutateAsync = vi.fn().mockResolvedValue(undefined);
const mockBriefMutate = vi.fn();
const mockBriefMutateAsync = vi.fn().mockResolvedValue(undefined);

let mockIntentData: unknown = undefined;
let mockBriefData: unknown = undefined;
let mockIsLoading = false;

// Intent mutation lifecycle
let mockIntentPending = false;
let mockIntentSuccess = false;
let mockIntentError = false;
// Brief-regenerate mutation lifecycle
let mockBriefPending = false;
let mockBriefSuccess = false;
let mockBriefError = false;

vi.mock("@/lib/hooks/reviews", () => ({
  usePrIntent: () => ({
    data: mockIntentData,
    isLoading: mockIsLoading,
  }),
  useRecomputeIntent: () => ({
    mutate: mockIntentMutate,
    mutateAsync: mockIntentMutateAsync,
    isPending: mockIntentPending,
    isSuccess: mockIntentSuccess,
    isError: mockIntentError,
  }),
  // The standalone Risks hooks must NOT be reached from IntentCard anymore. Expose
  // spies so the test can assert they are never called.
  usePrRisks: vi.fn(() => ({ data: undefined })),
  useRecomputeRisks: vi.fn(() => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
  })),
}));

vi.mock("@/lib/hooks/brief", () => ({
  useBrief: () => ({ data: mockBriefData }),
  useRegenerateBrief: () => ({
    mutate: mockBriefMutate,
    mutateAsync: mockBriefMutateAsync,
    isPending: mockBriefPending,
    isSuccess: mockBriefSuccess,
    isError: mockBriefError,
  }),
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/app" } }),
}));

vi.mock("@/lib/hooks/core", () => ({
  usePullDetail: () => ({ data: { head_sha: "abc123" } }),
}));

import { IntentCard } from "./IntentCard";
import { usePrRisks, useRecomputeRisks } from "@/lib/hooks/reviews";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockIntentMutateAsync.mockResolvedValue(undefined);
  mockBriefMutateAsync.mockResolvedValue(undefined);
  mockIntentData = undefined;
  mockBriefData = undefined;
  mockIsLoading = false;
  mockIntentPending = false;
  mockIntentSuccess = false;
  mockIntentError = false;
  mockBriefPending = false;
  mockBriefSuccess = false;
  mockBriefError = false;
});

const INTENT_RECORD = {
  pr_id: "pr1",
  intent: "Refactor the auth module to use JWT tokens.",
  in_scope: ["auth/login", "auth/logout"],
  out_of_scope: ["UI components", "email service"],
};

const BRIEF_RECORD = {
  pr_id: "pr1",
  generated_at: "2026-07-05T00:00:00Z",
  what: "w",
  why: "y",
  risk_level: "high",
  review_focus: [],
  risks: [
    {
      kind: "auth",
      title: "Token expiry not enforced",
      explanation: "Sessions never expire, enabling replay.",
      severity: "high",
      file_refs: ["src/middleware/ratelimit.ts:12-18"],
    },
    {
      kind: "dependency",
      title: "New dependency: ioredis",
      explanation: "Adds a network client with its own CVE surface.",
      severity: "medium",
      file_refs: ["package.json:34"],
    },
  ],
};

function renderCard(prId = "pr1") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      <IntentCard prId={prId} />
    </NextIntlClientProvider>,
  );
}

describe("IntentCard", () => {
  it("renders intent summary and scope lists when intent is present", () => {
    mockIntentData = INTENT_RECORD;

    renderCard();

    // Section header
    expect(screen.getByText("Intent")).toBeInTheDocument();

    // Intent summary text
    expect(
      screen.getByText("Refactor the auth module to use JWT tokens."),
    ).toBeInTheDocument();

    // In-scope section label and items
    expect(screen.getByText("In scope")).toBeInTheDocument();
    expect(screen.getByText("auth/login")).toBeInTheDocument();
    expect(screen.getByText("auth/logout")).toBeInTheDocument();

    // Out-of-scope section label and items
    expect(screen.getByText("Out of scope")).toBeInTheDocument();
    expect(screen.getByText("UI components")).toBeInTheDocument();
    expect(screen.getByText("email service")).toBeInTheDocument();

    // Single Recompute button
    expect(screen.getByRole("button", { name: /recompute/i })).toBeInTheDocument();
  });

  it("shows emptyScope label when in_scope or out_of_scope is empty", () => {
    mockIntentData = {
      ...INTENT_RECORD,
      in_scope: [],
      out_of_scope: [],
    };

    renderCard();

    // Both scope sections show the empty placeholder (there are two of them)
    const emptyLabels = screen.getAllByText("None specified");
    expect(emptyLabels).toHaveLength(2);
  });

  it("renders unavailable state when intent is null", () => {
    mockIntentData = null;

    renderCard();

    expect(screen.getByText("Brief not available yet.")).toBeInTheDocument();
    expect(
      screen.getByText("Run a review or open the PR to compute it."),
    ).toBeInTheDocument();

    // No intent summary text
    expect(
      screen.queryByText("Refactor the auth module to use JWT tokens."),
    ).not.toBeInTheDocument();
  });

  // ---- RISK AREAS subsection — now driven by the BRIEF's risks[] (T26 → AC-3) ----

  it("renders one collapsible row per brief risk with a kind icon, title, and file:line link", () => {
    mockIntentData = INTENT_RECORD;
    mockBriefData = BRIEF_RECORD;

    renderCard();

    // RISK AREAS header is present.
    expect(screen.getByText("Risks")).toBeInTheDocument();

    // One expander (button, aria-expanded) per risk — the title carries a textual
    // severity prefix (WCAG: never color alone) + the risk title.
    const highRow = screen.getByRole("button", {
      name: /high severity: token expiry not enforced/i,
    });
    const medRow = screen.getByRole("button", {
      name: /medium severity: new dependency: ioredis/i,
    });
    expect(highRow).toHaveAttribute("aria-expanded", "false");
    expect(medRow).toHaveAttribute("aria-expanded", "false");

    // Each row exposes a REAL file link with its line range (parsed from
    // file_refs' `path:range`), pointing to a safe github blob URL.
    const fileLink = screen.getByRole("link", { name: "src/middleware/ratelimit.ts:12-18" });
    const href = fileLink.getAttribute("href") ?? "";
    expect(href.startsWith("https://github.com/")).toBe(true);
    expect(href).not.toMatch(/^javascript:/i);
    expect(href).toContain("/blob/abc123/");
    expect(href).toContain("#L12-L18");
    expect(fileLink).toHaveAttribute("target", "_blank");
    expect(fileLink).toHaveAttribute("rel", "noopener noreferrer");

    // A single-line ref (no range) links to just that line.
    const pkgLink = screen.getByRole("link", { name: "package.json:34" });
    expect(pkgLink.getAttribute("href") ?? "").toContain("#L34");
  });

  it("reveals a risk's explanation when the row is activated by click AND by keyboard", () => {
    mockIntentData = INTENT_RECORD;
    mockBriefData = BRIEF_RECORD;

    renderCard();

    // Collapsed: the explanation is not in the DOM.
    expect(
      screen.queryByText("Sessions never expire, enabling replay."),
    ).not.toBeInTheDocument();

    const highRow = screen.getByRole("button", {
      name: /high severity: token expiry not enforced/i,
    });

    // Click expands and reveals the explanation.
    fireEvent.click(highRow);
    expect(highRow).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText("Sessions never expire, enabling replay."),
    ).toBeInTheDocument();

    // The expander is keyboard-operable: it is a native <button>, so Enter/Space
    // toggle it. Collapse again via keyboard (fireEvent.click models button
    // activation, which is what Enter/Space dispatch on a button).
    fireEvent.click(highRow);
    expect(highRow).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByText("Sessions never expire, enabling replay."),
    ).not.toBeInTheDocument();
  });

  it("does NOT call the standalone Risks hooks from IntentCard", () => {
    mockIntentData = INTENT_RECORD;
    mockBriefData = BRIEF_RECORD;

    renderCard();

    // RISK AREAS is sourced from the brief, so the standalone Risks artifact hooks
    // are never invoked here (they are left dead-but-present in the hooks module).
    expect(vi.mocked(usePrRisks)).not.toHaveBeenCalled();
    expect(vi.mocked(useRecomputeRisks)).not.toHaveBeenCalled();
  });

  it("shows the noRisks empty state under RISK AREAS when the brief has no risks", () => {
    mockIntentData = INTENT_RECORD;
    mockBriefData = { ...BRIEF_RECORD, risks: [] };

    renderCard();

    expect(screen.getByText("Risks")).toBeInTheDocument();
    expect(screen.getByText("No notable risks flagged.")).toBeInTheDocument();
  });

  it("renders a risk with no file_refs without a file link", () => {
    mockIntentData = INTENT_RECORD;
    mockBriefData = {
      ...BRIEF_RECORD,
      risks: [
        {
          kind: "performance",
          title: "Adds a Redis round-trip per request",
          explanation: "Every request now waits on the network.",
          severity: "low",
          file_refs: [],
        },
      ],
    };

    renderCard();

    const row = screen.getByRole("button", {
      name: /low severity: adds a redis round-trip per request/i,
    });
    expect(within(row).queryByRole("link")).not.toBeInTheDocument();
  });

  // ---- Stale freshness hint (is_stale on intent/brief records) ----

  it("renders the Outdated badge when usePrIntent reports is_stale", () => {
    mockIntentData = { ...INTENT_RECORD, is_stale: true };

    renderCard();

    // Badge conveys state via the visible text label (not color alone)
    expect(screen.getByText("Outdated")).toBeInTheDocument();
    // The caveat tooltip is present on the wrapping element
    expect(
      screen.getByTitle(/editing a linked issue is not auto-detected/i),
    ).toBeInTheDocument();
  });

  it("renders the Outdated badge when only the brief reports is_stale", () => {
    mockIntentData = INTENT_RECORD;
    mockBriefData = { ...BRIEF_RECORD, is_stale: true };

    renderCard();

    expect(screen.getByText("Outdated")).toBeInTheDocument();
  });

  it("does NOT render the Outdated badge when neither record is stale", () => {
    mockIntentData = INTENT_RECORD;
    mockBriefData = BRIEF_RECORD;

    renderCard();

    expect(screen.queryByText("Outdated")).not.toBeInTheDocument();
  });

  // ---- Single Recompute drives BOTH mutations (intent recompute + brief regen) ----

  it("clicking Recompute recomputes the intent AND regenerates the brief (intent first)", async () => {
    mockIntentData = INTENT_RECORD;
    mockBriefData = BRIEF_RECORD;

    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /recompute/i }));

    // Sequential: both mutateAsync run; intent must resolve before the brief regen.
    await vi.waitFor(() => {
      expect(mockIntentMutateAsync).toHaveBeenCalledOnce();
      expect(mockBriefMutateAsync).toHaveBeenCalledOnce();
    });
    // The brief-regenerate mutation is passed the prId.
    expect(mockBriefMutateAsync).toHaveBeenCalledWith("pr1");
  });

  it("shows computing label while either mutation is pending", () => {
    mockIntentData = INTENT_RECORD;
    mockBriefPending = true;

    renderCard();

    expect(screen.getByRole("button", { name: /computing/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^recompute$/i })).not.toBeInTheDocument();
  });

  it("renders nothing while loading", () => {
    mockIsLoading = true;

    const { container } = renderCard();

    // Loading state renders null — container should be empty
    expect(container.firstChild).toBeNull();
  });

  // ---- Combined aria-live region ----

  it("renders a visually-hidden aria-live status region next to the button", () => {
    mockIntentData = INTENT_RECORD;

    renderCard();

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");
    // Visually hidden (srOnly) but present in the DOM
    expect(status).toHaveStyle({ position: "absolute", width: "1px", height: "1px" });
    // Idle → no announcement text
    expect(status).toBeEmptyDOMElement();
  });

  it("announces the combined success copy when BOTH mutations resolve", () => {
    mockIntentData = INTENT_RECORD;
    mockIntentSuccess = true;
    mockBriefSuccess = true;

    renderCard();

    expect(screen.getByRole("status")).toHaveTextContent("Intent and risks updated");
  });

  it("announces failure when either mutation rejects", () => {
    mockIntentData = INTENT_RECORD;
    mockBriefError = true;

    renderCard();

    expect(screen.getByRole("status")).toHaveTextContent("Recompute failed");
  });

  it("announces computing while either mutation is pending", () => {
    mockIntentData = INTENT_RECORD;
    mockIntentPending = true;

    renderCard();

    expect(screen.getByRole("status")).toHaveTextContent("Computing…");
  });

  it("keeps the status region (and single button) in the unavailable branch", () => {
    mockIntentData = null;
    mockIntentError = true;

    renderCard();

    // The unavailable branch also renders the single Recompute button + its region
    expect(screen.getByText("Brief not available yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /recompute/i })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Recompute failed");
  });

  // ---- Issue #8: Recompute lives in the SectionLabel right-slot (top-right),
  //      not at the bottom of the card, in BOTH the unavailable and computed
  //      branches. ----

  it("places Recompute in the SectionLabel header row (top-right) when intent is unavailable", () => {
    mockIntentData = null;

    renderCard();

    const button = screen.getByRole("button", { name: /recompute/i });
    const header = screen.getByText("Intent").closest("div");
    // The button sits inside the same header row as the "Intent" label — the
    // SectionLabel right-slot — rather than trailing the card body.
    expect(header).not.toBeNull();
    expect(header).toContainElement(button);

    // It must come BEFORE the unavailable copy in DOM order (header renders
    // first), proving it is no longer the card's trailing element.
    const unavailable = screen.getByText("Brief not available yet.");
    expect(
      button.compareDocumentPosition(unavailable) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("places Recompute in the SectionLabel header row (top-right) when intent is present", () => {
    mockIntentData = INTENT_RECORD;

    renderCard();

    const button = screen.getByRole("button", { name: /recompute/i });
    const header = screen.getByText("Intent").closest("div");
    expect(header).not.toBeNull();
    expect(header).toContainElement(button);
  });
});
