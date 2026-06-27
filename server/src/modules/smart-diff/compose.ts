import type { SmartDiff, SmartDiffGroup, SmartDiffRole } from '@devdigest/shared';
import { classifyFile } from './classify.js';
import { SPLIT_TOO_BIG_LINES } from './constants.js';

/** Minimal file shape compose needs — the service maps `pr_files` rows down to this. */
interface FileInput {
  path: string;
  additions: number;
  deletions: number;
}

/** Fixed group order: business logic first, generated noise last. */
const ROLE_ORDER: readonly SmartDiffRole[] = ['core', 'wiring', 'boilerplate'];

/**
 * Deterministically compose the stored PR files + already-expanded finding lines
 * into the `SmartDiff` contract shape. Pure: no IO, no DB, and crucially NO LLM —
 * `pseudocode_summary` is therefore `null` for every file (a deliberate fidelity
 * tradeoff vs. the screenshot's "What this does" prose; the client renders it
 * conditionally so a future lab can backfill it).
 *
 * @param files          The PR's changed files (path + line counts).
 * @param findingsByPath Latest-review, non-dismissed finding line numbers per
 *                       path, ALREADY expanded by the service (Phase B). Compose
 *                       only sorts + de-dupes them; it does not build the map.
 */
export function composeSmartDiff(
  files: FileInput[],
  findingsByPath: Map<string, number[]>,
): SmartDiff {
  // Bucket files by role, preserving input order within each bucket.
  const byRole = new Map<SmartDiffRole, SmartDiffGroup['files']>();
  for (const role of ROLE_ORDER) byRole.set(role, []);

  for (const file of files) {
    const role = classifyFile(file.path, file.additions, file.deletions);
    const lines = findingsByPath.get(file.path) ?? [];
    // Sort ascending + de-dupe the finding line numbers.
    const finding_lines = Array.from(new Set(lines)).sort((a, b) => a - b);

    byRole.get(role)!.push({
      path: file.path,
      pseudocode_summary: null, // KEY PRINCIPLE: no LLM here.
      additions: file.additions,
      deletions: file.deletions,
      finding_lines,
    });
  }

  // Emit groups in fixed order, OMITTING zero-file groups so the UI renders
  // only present roles (documented assumption in the spec).
  const groups: SmartDiffGroup[] = ROLE_ORDER.map((role) => ({
    role,
    files: byRole.get(role)!,
  })).filter((g) => g.files.length > 0);

  const total_lines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
  const too_big = total_lines > SPLIT_TOO_BIG_LINES;

  // Heuristic split (no LLM): group paths by their top-level directory segment,
  // but only when the PR is too big AND spans ≥2 distinct top-level dirs.
  const proposed_splits = too_big ? proposeSplits(files) : [];

  return {
    groups,
    split_suggestion: { too_big, total_lines, proposed_splits },
  };
}

/** Group file paths by their top-level directory; empty unless ≥2 distinct dirs. */
function proposeSplits(files: FileInput[]): SmartDiff['split_suggestion']['proposed_splits'] {
  const byDir = new Map<string, string[]>();
  for (const file of files) {
    const slash = file.path.indexOf('/');
    // Files at the repo root (no slash) bucket under their own path.
    const dir = slash === -1 ? file.path : file.path.slice(0, slash);
    const bucket = byDir.get(dir);
    if (bucket) bucket.push(file.path);
    else byDir.set(dir, [file.path]);
  }

  if (byDir.size < 2) return [];

  return Array.from(byDir, ([name, paths]) => ({ name, files: paths }));
}
