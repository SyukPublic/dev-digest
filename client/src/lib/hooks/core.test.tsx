import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useInvalidateOnHeadChange } from "./core";

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
