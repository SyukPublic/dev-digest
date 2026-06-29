import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/brief.json";

// --- Mutable stubs for usePrIntent / useRecomputeIntent / usePrRisks /
//     useRecomputeRisks. The single Recompute button drives BOTH mutations, so
//     each gets its own mutate/mutateAsync + lifecycle flags. ---
const mockIntentMutate = vi.fn();
const mockIntentMutateAsync = vi.fn().mockResolvedValue(undefined);
const mockRisksMutate = vi.fn();
const mockRisksMutateAsync = vi.fn().mockResolvedValue(undefined);

let mockIntentData: unknown = undefined;
let mockRisksData: unknown = undefined;
let mockIsLoading = false;

// Intent mutation lifecycle
let mockIntentPending = false;
let mockIntentSuccess = false;
let mockIntentError = false;
// Risks mutation lifecycle
let mockRisksPending = false;
let mockRisksSuccess = false;
let mockRisksError = false;

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
  usePrRisks: () => ({
    data: mockRisksData,
  }),
  useRecomputeRisks: () => ({
    mutate: mockRisksMutate,
    mutateAsync: mockRisksMutateAsync,
    isPending: mockRisksPending,
    isSuccess: mockRisksSuccess,
    isError: mockRisksError,
  }),
}));

import { IntentCard } from "./IntentCard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockIntentMutateAsync.mockResolvedValue(undefined);
  mockRisksMutateAsync.mockResolvedValue(undefined);
  mockIntentData = undefined;
  mockRisksData = undefined;
  mockIsLoading = false;
  mockIntentPending = false;
  mockIntentSuccess = false;
  mockIntentError = false;
  mockRisksPending = false;
  mockRisksSuccess = false;
  mockRisksError = false;
});

const INTENT_RECORD = {
  pr_id: "pr1",
  intent: "Refactor the auth module to use JWT tokens.",
  in_scope: ["auth/login", "auth/logout"],
  out_of_scope: ["UI components", "email service"],
};

const RISKS_RECORD = {
  pr_id: "pr1",
  risks: [
    {
      kind: "auth",
      title: "Token expiry not enforced",
      explanation: "Sessions never expire, enabling replay.",
      severity: "high",
      file_refs: ["auth/login.ts"],
    },
    {
      kind: "performance",
      title: "N+1 query on login",
      explanation: "Each login triggers a per-role lookup.",
      severity: "medium",
      file_refs: [],
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

  // ---- RISK AREAS subsection (absorbed into the same INTENT card) ----

  it("renders one pill per risk with kind icon + title and the severity sr-prefix", () => {
    mockIntentData = INTENT_RECORD;
    mockRisksData = RISKS_RECORD;

    renderCard();

    // RISK AREAS header is present
    expect(screen.getByText("Risks")).toBeInTheDocument();

    // One pill per risk — title rendered as visible text
    expect(screen.getByText("Token expiry not enforced")).toBeInTheDocument();
    expect(screen.getByText("N+1 query on login")).toBeInTheDocument();

    // WCAG: severity is conveyed by a textual sr-only prefix, not color alone
    expect(screen.getByText("High severity:")).toBeInTheDocument();
    expect(screen.getByText("Medium severity:")).toBeInTheDocument();

    // The full explanation is preserved in the native title tooltip
    expect(
      screen.getByTitle("Sessions never expire, enabling replay."),
    ).toBeInTheDocument();
  });

  it("shows the noRisks empty state under RISK AREAS when there are no risks", () => {
    mockIntentData = INTENT_RECORD;
    mockRisksData = { pr_id: "pr1", risks: [] };

    renderCard();

    expect(screen.getByText("Risks")).toBeInTheDocument();
    expect(screen.getByText("No notable risks flagged.")).toBeInTheDocument();
  });

  // ---- Stale freshness hint (is_stale on intent/risks records) ----

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

  it("renders the Outdated badge when only the risks record reports is_stale", () => {
    mockIntentData = INTENT_RECORD;
    mockRisksData = { ...RISKS_RECORD, is_stale: true };

    renderCard();

    expect(screen.getByText("Outdated")).toBeInTheDocument();
  });

  it("does NOT render the Outdated badge when neither record is stale", () => {
    mockIntentData = INTENT_RECORD;
    mockRisksData = RISKS_RECORD;

    renderCard();

    expect(screen.queryByText("Outdated")).not.toBeInTheDocument();
  });

  // ---- Single Recompute drives BOTH mutations ----

  it("clicking Recompute calls BOTH the intent and risks mutations (intent first)", async () => {
    mockIntentData = INTENT_RECORD;
    mockRisksData = RISKS_RECORD;

    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /recompute/i }));

    // Sequential: both mutateAsync run; intent must resolve before risks fire.
    await vi.waitFor(() => {
      expect(mockIntentMutateAsync).toHaveBeenCalledOnce();
      expect(mockRisksMutateAsync).toHaveBeenCalledOnce();
    });
  });

  it("shows computing label while either mutation is pending", () => {
    mockIntentData = INTENT_RECORD;
    mockRisksPending = true;

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
    mockRisksSuccess = true;

    renderCard();

    expect(screen.getByRole("status")).toHaveTextContent("Intent and risks updated");
  });

  it("announces failure when either mutation rejects", () => {
    mockIntentData = INTENT_RECORD;
    mockRisksError = true;

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
