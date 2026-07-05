import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { LiveLogStream, type LogLine } from "./LiveLogStream";

/**
 * LiveLogStream — post `useCopyToClipboard` extraction regression test (T14,
 * AC-17). LiveLogStream was one of the three inline `navigator.clipboard`
 * duplicates Phase 4 (CP-9) consolidated into the shared hook. This proves the
 * consumer still copies the (filtered) log verbatim after the refactor, and
 * that the pre-existing filter behavior is untouched — neither had a
 * dedicated test before (only smoke-tested via the filter *placeholder* in
 * `RunTraceDrawer.test.tsx`).
 *
 * Unit under test: `LiveLogStream`.
 * Input: a 3-line `log` fixture; stub `navigator.clipboard.writeText`.
 * Expected output: "Copy log" writes the newline-joined `[t] [k] m` lines to
 * the clipboard; typing into the filter narrows the visible lines by
 * substring match on message or kind.
 */

const LOG: LogLine[] = [
  { t: "00.10", k: "info", m: "Starting review" },
  { t: "00.50", k: "tool", m: "review_file src/config.ts" },
  { t: "00.90", k: "result", m: "Citation grounding: 2/2 passed" },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LiveLogStream — copy uses the shared useCopyToClipboard hook", () => {
  it("copies the full formatted log to the clipboard", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<LiveLogStream log={LOG} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy log" }));

    expect(writeText).toHaveBeenCalledWith(
      "[00.10] [info] Starting review\n" +
        "[00.50] [tool] review_file src/config.ts\n" +
        "[00.90] [result] Citation grounding: 2/2 passed",
    );
  });

  it("copies only the currently filtered lines, not the full log", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<LiveLogStream log={LOG} />);
    fireEvent.change(screen.getByPlaceholderText("Filter log…"), { target: { value: "grounding" } });
    fireEvent.click(screen.getByRole("button", { name: "Copy log" }));

    expect(writeText).toHaveBeenCalledWith("[00.90] [result] Citation grounding: 2/2 passed");
  });

  it("filters visible log lines by message substring (unaffected by the copy refactor)", () => {
    render(<LiveLogStream log={LOG} />);

    expect(screen.getByText("Starting review")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Filter log…"), { target: { value: "config" } });

    expect(screen.queryByText("Starting review")).not.toBeInTheDocument();
    expect(screen.getByText("review_file src/config.ts")).toBeInTheDocument();
  });
});
