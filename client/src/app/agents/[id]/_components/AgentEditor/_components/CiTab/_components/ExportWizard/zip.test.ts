import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import type { CiFile } from "@devdigest/shared";
import { downloadBundleZip } from "./zip";

// Unit under test: downloadBundleZip(files, repoName) — the AC-54 client-side
// zip helper. Input: an in-memory CiFile[] bundle + a repo name. jsdom has no
// URL.createObjectURL/anchor-download, so we stub those two browser APIs and
// spy HTMLAnchorElement.prototype.click (to avoid jsdom "not implemented"
// navigation noise on a fake blob: href) — everything else (fflate zipping,
// Blob construction, filename derivation) runs for real. Expected output:
// the produced archive round-trips (via fflate.unzipSync) to the exact same
// file contents, and the triggered anchor carries a sanitized filename.
const FILES: CiFile[] = [
  { path: ".devdigest/agents/security-reviewer.yaml", contents: "name: sec", editable: true },
  { path: ".github/workflows/devdigest-review.yml", contents: "on: pull_request", editable: true },
];

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let clickedAnchor: { href: string; download: string } | null;
let capturedBlobParts: BlobPart[] | null;

// jsdom's Blob has no .arrayBuffer()/.text() to read content back, so capture
// the raw bytes at construction time instead (a real Blob is still built —
// this only observes the constructor args).
const RealBlob = globalThis.Blob;
class CapturingBlob extends RealBlob {
  constructor(parts: BlobPart[], options?: BlobPropertyBag) {
    super(parts, options);
    capturedBlobParts = parts;
  }
}

beforeEach(() => {
  clickedAnchor = null;
  capturedBlobParts = null;
  createObjectURL = vi.fn(() => "blob:mock-url");
  revokeObjectURL = vi.fn();
  // jsdom lacks these Blob-URL APIs — stub per client INSIGHTS.md convention.
  globalThis.URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
  globalThis.URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
  globalThis.Blob = CapturingBlob as unknown as typeof Blob;
  // Intercept the real anchor click so jsdom never attempts to navigate to
  // the fake "blob:mock-url" href (which would log a "not implemented" error).
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clickedAnchor = { href: this.href, download: this.download };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.Blob = RealBlob;
});

describe("downloadBundleZip (test_zip_download_files)", () => {
  it("zips the merged bundle into a real archive and triggers a download with a sanitized filename", () => {
    downloadBundleZip(FILES, "acme/api");

    // A single application/zip Blob is created…
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe("application/zip");

    // …and it genuinely contains the exact bundle contents (round-trip via fflate,
    // not just an assertion on call arguments — the archive itself is verified).
    const bytes = capturedBlobParts![0] as Uint8Array;
    const unzipped = unzipSync(bytes);
    expect(strFromU8(unzipped[FILES[0]!.path]!)).toBe("name: sec");
    expect(strFromU8(unzipped[FILES[1]!.path]!)).toBe("on: pull_request");

    // A download was triggered with a "/" sanitized into the slug…
    expect(clickedAnchor?.download).toBe("devdigest-ci-acme-api.zip");
    expect(clickedAnchor?.href).toContain("mock-url");

    // …and the object URL is released after the click, with no anchor left behind.
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    expect(document.body.querySelector("a[download]")).toBeNull();
  });

  it("falls back to a 'bundle' filename when the repo name has no safe characters", () => {
    downloadBundleZip(FILES, "!!!");
    expect(clickedAnchor?.download).toBe("devdigest-ci-bundle.zip");
  });
});
