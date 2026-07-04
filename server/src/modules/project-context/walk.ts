/**
 * project-context walker — discover markdown docs in the read-only clone.
 *
 * Fresh, markdown-scoped walker (NOT repo-intel's `walkClone`, which is coupled
 * to code extensions and lives behind the repo-intel facade). Borrows its proven
 * patterns: symlink-skip (loops/perf), forward-slash relpaths (platform-agnostic
 * rows), unreadable-dir tolerance (keep making progress), and a byte size cap.
 *
 * Scope: globs ONLY `*.md` files under the configured top-level ROOTS
 * (`specs`/`docs`/`insights` by default), at ANY depth. Returns each doc with a
 * repo-relative POSIX path and the `folder_type` badge = the root it lives under
 * (AC-1). Degrades to an EMPTY list — never throws — when a root is absent or the
 * whole clone is missing (AC-16). Pure discovery: no LLM/embedding calls (AC-23).
 */
import { readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { EXCLUDED_DIRS, MARKDOWN_EXT } from './constants.js';

export interface WalkedDoc {
  /** Repo-relative POSIX path (e.g. `docs/specs/foo.md`). */
  path: string;
  /** The configured root this doc lives under (its badge). */
  folderType: string;
}

/**
 * Walk each configured `root` under `cloneRoot`, returning every markdown file
 * (any depth). A missing/unreadable root contributes nothing (no throw). Results
 * are sorted by path for a stable, reproducible order.
 *
 * @param cloneRoot absolute path to the repo's clone (`git.clonePathFor(repo)`)
 * @param roots     top-level folder names to glob under (already de-duped)
 * @param maxBytes  per-file byte cap; files larger are skipped (never returned)
 */
export async function walkMarkdown(
  cloneRoot: string,
  roots: readonly string[],
  maxBytes: number,
): Promise<WalkedDoc[]> {
  const out: WalkedDoc[] = [];
  for (const root of roots) {
    const rootAbs = join(cloneRoot, root);
    await walkDir(cloneRoot, rootAbs, root, maxBytes, out);
  }
  // Stable, reproducible order across runs and platforms.
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

async function walkDir(
  cloneRoot: string,
  dir: string,
  folderType: string,
  maxBytes: number,
  out: WalkedDoc[],
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    // Absent root (AC-16) or unreadable dir (permissions, dangling symlink) —
    // skip cleanly so discovery still returns whatever it CAN read.
    return;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue; // never follow symlinks (loops, perf)
    const name = entry.name;

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(name)) continue;
      await walkDir(cloneRoot, join(dir, name), folderType, maxBytes, out);
      continue;
    }

    if (!entry.isFile()) continue;
    if (!name.toLowerCase().endsWith(MARKDOWN_EXT)) continue;

    const full = join(dir, name);
    let size: number;
    try {
      size = (await stat(full)).size;
    } catch {
      continue;
    }
    if (size > maxBytes) continue; // over the per-file cap → not discoverable

    // POSIX-style relative path so rows/DTOs are platform-agnostic (matches the
    // `pr_files.path` convention).
    const path = relative(cloneRoot, full).split(sep).join('/');
    out.push({ path, folderType });
  }
}
