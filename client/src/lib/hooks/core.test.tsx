import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useInvalidateOnHeadChange, useRefreshRepo } from "./core";

vi.mock("../api", () => ({
  api: { post: vi.fn(() => Promise.resolve({})) },
}));

afterEach(() => vi.clearAllMocks());

function setup() {
  const qc = new QueryClient();
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries").mockImplementation(() => Promise.resolve());
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { invalidateSpy, wrapper };
}

describe("useInvalidateOnHeadChange", () => {
  it("invalidates reviews + smart-diff when head_sha changes (single reload convergence)", () => {
    const { invalidateSpy, wrapper } = setup();
    const { rerender } = renderHook(
      ({ headSha }: { headSha: string }) => useInvalidateOnHeadChange("pr1", headSha),
      { wrapper, initialProps: { headSha: "sha-old" } },
    );

    // First observed head for this PR → no invalidation (initial load already targets it).
    expect(invalidateSpy).not.toHaveBeenCalled();

    // A genuine head change → invalidate BOTH dependent queries, keyed by prId.
    rerender({ headSha: "sha-new" });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["reviews", "pr1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["smart-diff", "pr1"] });
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });

  it("does NOT invalidate when head_sha is unchanged across re-renders (no spurious refetch)", () => {
    const { invalidateSpy, wrapper } = setup();
    const { rerender } = renderHook(
      ({ headSha }: { headSha: string }) => useInvalidateOnHeadChange("pr1", headSha),
      { wrapper, initialProps: { headSha: "sha-x" } },
    );

    rerender({ headSha: "sha-x" });
    rerender({ headSha: "sha-x" });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("does nothing while prId or head_sha is null (PR not resolved yet)", () => {
    const { invalidateSpy, wrapper } = setup();
    const { rerender } = renderHook(
      ({ prId, headSha }: { prId: string | null; headSha: string | null }) =>
        useInvalidateOnHeadChange(prId, headSha),
      { wrapper, initialProps: { prId: null as string | null, headSha: null as string | null } },
    );

    rerender({ prId: "pr1", headSha: null });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe("useRefreshRepo", () => {
  it("stays pending until the invalidation refetches settle (busy hands over to `indexing` with no idle gap)", async () => {
    const qc = new QueryClient();
    // Gate the invalidations so we can observe the in-between state: POST done,
    // refetches still in flight.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries").mockImplementation(() => gate);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useRefreshRepo(), { wrapper });

    act(() => {
      result.current.mutate("r1");
    });

    // POST resolved (mocked) and onSuccess fired → all three invalidations issued…
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["repo-intel-state", "r1"] }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["repos"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["pulls", "r1"] });
    // …but the mutation must STILL be pending: onSuccess returns the
    // Promise.all, so `isPending` covers the refetch window and the button's
    // busy state hands over to the refetched `indexing: true` without a
    // busy→idle→busy flicker.
    expect(result.current.isPending).toBe(true);

    release();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
