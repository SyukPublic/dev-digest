import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRefetchBlastOnReindex } from "./repo-intel";

afterEach(() => vi.clearAllMocks());

function setup() {
  const qc = new QueryClient();
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries").mockImplementation(() => Promise.resolve());
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { invalidateSpy, wrapper };
}

describe("useRefetchBlastOnReindex", () => {
  it("does NOT invalidate on the first sha observed for a repo (mount already used that index)", () => {
    const { invalidateSpy, wrapper } = setup();
    renderHook(
      ({ sha }: { sha: string }) => useRefetchBlastOnReindex("repo1", sha),
      { wrapper, initialProps: { sha: "sha-old" } },
    );

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("invalidates blast (prefix key) once when lastIndexedSha advances (reindex completed)", () => {
    const { invalidateSpy, wrapper } = setup();
    const { rerender } = renderHook(
      ({ sha }: { sha: string }) => useRefetchBlastOnReindex("repo1", sha),
      { wrapper, initialProps: { sha: "sha-old" } },
    );

    // First observed sha for this repo → no invalidation.
    expect(invalidateSpy).not.toHaveBeenCalled();

    // A subsequent sha change → invalidate the whole `["blast"]` prefix, once.
    rerender({ sha: "sha-new" });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["blast"] });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT invalidate when the sha is unchanged across re-renders (no spurious refetch)", () => {
    const { invalidateSpy, wrapper } = setup();
    const { rerender } = renderHook(
      ({ sha }: { sha: string }) => useRefetchBlastOnReindex("repo1", sha),
      { wrapper, initialProps: { sha: "sha-x" } },
    );

    rerender({ sha: "sha-x" });
    rerender({ sha: "sha-x" });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("does nothing while repoId or lastIndexedSha is null (repo/index not resolved yet)", () => {
    const { invalidateSpy, wrapper } = setup();
    const { rerender } = renderHook(
      ({ repoId, sha }: { repoId: string | null; sha: string | null }) =>
        useRefetchBlastOnReindex(repoId, sha),
      { wrapper, initialProps: { repoId: null as string | null, sha: null as string | null } },
    );

    rerender({ repoId: "repo1", sha: null });
    rerender({ repoId: null, sha: "sha-1" });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
