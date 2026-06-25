import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/brief.json";

// --- Mutable stubs for usePrIntent / useRecomputeIntent ---
const mockMutate = vi.fn();
let mockIntentData: unknown = undefined;
let mockIsLoading = false;
let mockIsPending = false;

vi.mock("@/lib/hooks/reviews", () => ({
  usePrIntent: () => ({
    data: mockIntentData,
    isLoading: mockIsLoading,
  }),
  useRecomputeIntent: () => ({
    mutate: mockMutate,
    isPending: mockIsPending,
  }),
}));

import { IntentCard } from "./IntentCard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockIntentData = undefined;
  mockIsLoading = false;
  mockIsPending = false;
});

const INTENT_RECORD = {
  pr_id: "pr1",
  intent: "Refactor the auth module to use JWT tokens.",
  in_scope: ["auth/login", "auth/logout"],
  out_of_scope: ["UI components", "email service"],
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

    // Recompute button
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

  it("clicking Recompute calls the mutation", () => {
    mockIntentData = INTENT_RECORD;

    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /recompute/i }));

    expect(mockMutate).toHaveBeenCalledOnce();
  });

  it("shows computing label while mutation is pending", () => {
    mockIntentData = INTENT_RECORD;
    mockIsPending = true;

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
});
