/* OverviewTab — block order (R3, AC-7): PR Brief → intent/blast grid → Review
   focus → Description. The child cards are heavy data components; stub them to
   sentinel markers so the test asserts only the composition ORDER. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/lib/repo-context", () => ({ useActiveRepo: () => ({ repoId: "r1" }) }));
vi.mock("@/lib/hooks/repo-intel", () => ({
  useRepoIntelStatus: () => ({ data: { lastIndexedSha: "sha" } }),
  useRefetchBlastOnReindex: () => {},
}));
vi.mock("../PrBriefCard", () => ({ PrBriefCard: () => <div data-testid="pr-brief" /> }));
vi.mock("../IntentCard", () => ({ IntentCard: () => <div data-testid="intent" /> }));
vi.mock("../BlastCard", () => ({ BlastCard: () => <div data-testid="blast" /> }));
vi.mock("../ReviewFocusSection", () => ({
  ReviewFocusSection: () => <div data-testid="review-focus" />,
}));

import { OverviewTab } from "./OverviewTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OverviewTab — block order (AC-7)", () => {
  it("renders PR Brief → grid → Review focus → Description in that order", () => {
    render(<OverviewTab prId="pr1" prBody="A PR description." />);

    const markers = ["pr-brief", "intent", "blast", "review-focus"].map((id) =>
      screen.getByTestId(id),
    );
    const description = screen.getByText("A PR description.");

    // DOM order is document order — assert each precedes the next.
    const ordered = [...markers, description];
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(
        ordered[i]!.compareDocumentPosition(ordered[i + 1]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("omits Description when prBody is empty (Review focus still renders)", () => {
    render(<OverviewTab prId="pr1" prBody={null} />);
    expect(screen.getByTestId("review-focus")).toBeInTheDocument();
    expect(screen.queryByText("Description")).not.toBeInTheDocument();
  });
});
