import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCopyToClipboard } from "./useCopyToClipboard";

describe("useCopyToClipboard", () => {
  const writeText = vi.fn(() => Promise.resolve());

  beforeEach(() => {
    vi.useFakeTimers();
    writeText.mockClear();
    Object.assign(navigator, { clipboard: { writeText } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes text to the clipboard and flips `copied`, then resets after the delay", () => {
    const { result } = renderHook(() => useCopyToClipboard(1500));

    expect(result.current.copied).toBe(false);

    act(() => result.current.copy("hello"));

    expect(writeText).toHaveBeenCalledWith("hello");
    expect(result.current.copied).toBe(true);

    // Still flagged just before the reset window elapses.
    act(() => vi.advanceTimersByTime(1499));
    expect(result.current.copied).toBe(true);

    // Resets once the (configurable) window elapses.
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.copied).toBe(false);
  });

  it("honours a custom reset delay", () => {
    const { result } = renderHook(() => useCopyToClipboard(500));

    act(() => result.current.copy("x"));
    expect(result.current.copied).toBe(true);

    act(() => vi.advanceTimersByTime(500));
    expect(result.current.copied).toBe(false);
  });
});
