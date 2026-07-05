import type { Brief, BriefInputBundle } from '@devdigest/shared';

/**
 * grounding.ts — PURE real-path drop/repair of the model's brief against the
 * REAL file set the assembler built (CP-5, AC-4/5).
 *
 * The model may cite an INVENTED path in a `risks[].file_refs` entry or a
 * `review_focus[].path`. This is both a correctness and a SAFETY control
 * (Agentic ASI09 — validate generated content before storing): a fabricated
 * path must never be persisted, so it cannot later render as a working link.
 *
 * The `realPaths` set is EVERY path present in the assembled bundle
 * (`blast_files[].path` ∪ `smart_diff_groups[].files[].path`) — the SAME set the
 * assembler produced and the prompt showed the model. Grounding runs BEFORE
 * persist, on the server, with no I/O.
 *
 * Rules:
 *  - `risks[].file_refs` entry `"path:range"` — split the `:range` suffix, keep
 *    the entry IFF the PATH portion is in `realPaths`; drop the whole entry
 *    otherwise (repair = keep only surviving refs). A risk whose refs ALL drop
 *    is still persisted (title/explanation/severity) — just without a fabricated
 *    link (AC-5).
 *  - `review_focus[].path` — drop the whole item when its path ∉ `realPaths`.
 *  - Everything else (what/why/risk_level, surviving risks/focus) is kept.
 */

/** Build the real-path set from the assembled bundle (the grounding authority). */
export function realPathSet(bundle: BriefInputBundle): Set<string> {
  const paths = new Set<string>();
  for (const f of bundle.blast_files) paths.add(f.path);
  for (const g of bundle.smart_diff_groups) {
    for (const f of g.files) paths.add(f.path);
  }
  return paths;
}

/**
 * Strip the trailing `:range` (e.g. `src/config.ts:12-18` → `src/config.ts`).
 * Only a trailing `:<digits>` / `:<digits>-<digits>` line-range is stripped; a
 * `:` elsewhere in a path (rare, but valid on some filesystems) is preserved.
 */
export function pathOfRef(ref: string): string {
  return ref.replace(/:\d+(?:-\d+)?$/, '');
}

/**
 * Ground the model's brief against the bundle's real file set (AC-4/5). Returns
 * a NEW Brief with invented `file_refs` entries and `review_focus` items dropped;
 * the caller persists the grounded result.
 */
export function groundBrief(brief: Brief, bundle: BriefInputBundle): Brief {
  const realPaths = realPathSet(bundle);

  const risks = brief.risks.map((risk) => ({
    ...risk,
    // Keep only refs whose PATH portion is real; a risk with zero surviving
    // refs is still persisted (title/explanation), just unlinked.
    file_refs: risk.file_refs.filter((ref) => realPaths.has(pathOfRef(ref))),
  }));

  const review_focus = brief.review_focus.filter((item) => realPaths.has(item.path));

  return { ...brief, risks, review_focus };
}
