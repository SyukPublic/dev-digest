import { zipSync, strToU8 } from "fflate";
import type { CiFile } from "@devdigest/shared";

/**
 * Build a zip archive from the in-memory CI bundle and trigger a browser
 * download. Client-side by design (AC-54): the files already live in the wizard
 * (`mergedFiles`, Step-2 edits included), so zipping them here needs no server
 * round-trip — a re-fetch would regenerate the bundle and discard those edits.
 *
 * The archive carries only the generated bundle (manifest + skills + memory +
 * committed runner + workflow); no secret is inlined (the workflow references
 * `OPENROUTER_API_KEY` from repo secrets, never its value, and no GITHUB_TOKEN).
 *
 * Colocated helper (not a shared util) — the download side effect stays out of
 * the render body.
 */
export function downloadBundleZip(files: CiFile[], repoName: string): void {
  // fflate expects nested paths as flat keys → Uint8Array contents.
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.path] = strToU8(f.contents);

  const zipped = zipSync(entries, { level: 6 });
  // Copy into a fresh ArrayBuffer-backed view so the Blob type matches the DOM
  // BlobPart signature regardless of fflate's return-buffer typing.
  const blob = new Blob([zipped.slice()], { type: "application/zip" });

  const url = URL.createObjectURL(blob);
  const slug = repoName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "bundle";
  const a = document.createElement("a");
  a.href = url;
  a.download = `devdigest-ci-${slug}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
