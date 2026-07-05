import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../../../messages/en/runs.json"; // client/messages/en/runs.json

import { PromptBlock } from "./PromptBlock";

/**
 * PromptBlock — post `useCopyToClipboard` extraction regression test (T14,
 * AC-17, AC-21). PromptBlock was one of the three inline `navigator.clipboard`
 * duplicates (RunTraceDrawer.tsx, PromptBlock.tsx, LiveLogStream.tsx) that
 * Phase 4 (CP-9) consolidated into the shared `useCopyToClipboard` hook. The
 * hook itself is unit-tested in isolation
 * (`client/src/vendor/ui/hooks/useCopyToClipboard.test.ts`); this test proves
 * the CONSUMER still copies the right text end-to-end after the refactor —
 * unchanged behavior was asserted by the plan (T14) but had no regression
 * coverage for this call site until now.
 *
 * Unit under test: `PromptBlock`.
 * Input: `label="System"`, `text="You are a reviewer."`, `color="#2563eb"`.
 * Stub: `navigator.clipboard.writeText` (jsdom has no real clipboard).
 * Expected output: clicking the header's copy button writes the block's exact
 * `text` to the clipboard; the header click still toggles the expanded body
 * (unrelated behavior, unaffected by the extraction).
 */

function renderBlock(props: Partial<React.ComponentProps<typeof PromptBlock>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <PromptBlock label="System" text="You are a reviewer." color="#2563eb" {...props} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PromptBlock — copy uses the shared useCopyToClipboard hook", () => {
  it("copies the block's exact text to the clipboard on copy-button click", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderBlock();

    const copyBtn = screen.getByRole("button", { name: "Copy" });
    fireEvent.click(copyBtn);

    expect(writeText).toHaveBeenCalledWith("You are a reviewer.");
  });

  it("expanding the header (unrelated to copy) still reveals the raw prompt text", () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    renderBlock({ text: "Full system prompt body." });

    expect(screen.queryByText("Full system prompt body.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("System"));
    expect(screen.getByText("Full system prompt body.")).toBeInTheDocument();
  });
});
