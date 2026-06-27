import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });

  // --- Stage 2 / L1: stale-anchor badge by anchor_status ---

  it("renders the 'Outdated' badge for a moved_out finding", () => {
    renderWithIntl(<FindingCard f={{ ...FINDING, anchor_status: "moved_out" }} onAction={() => {}} />);
    expect(screen.getByText("Outdated")).toBeInTheDocument();
    // moved_out copy explains the line moved; the orphaned copy is NOT shown.
    expect(screen.queryByText("File removed")).not.toBeInTheDocument();
  });

  it("renders the 'File removed' badge for an orphaned finding", () => {
    renderWithIntl(<FindingCard f={{ ...FINDING, anchor_status: "orphaned" }} onAction={() => {}} />);
    expect(screen.getByText("File removed")).toBeInTheDocument();
    expect(screen.queryByText("Outdated")).not.toBeInTheDocument();
  });

  it("renders NO stale badge for current / absent anchor_status (behaves as today)", () => {
    renderWithIntl(<FindingCard f={{ ...FINDING, anchor_status: "current" }} onAction={() => {}} />);
    expect(screen.queryByText("Outdated")).not.toBeInTheDocument();
    expect(screen.queryByText("File removed")).not.toBeInTheDocument();

    cleanup();
    // anchor_status omitted entirely → still no badge.
    renderWithIntl(<FindingCard f={FINDING} onAction={() => {}} />);
    expect(screen.queryByText("Outdated")).not.toBeInTheDocument();
    expect(screen.queryByText("File removed")).not.toBeInTheDocument();
  });
});
