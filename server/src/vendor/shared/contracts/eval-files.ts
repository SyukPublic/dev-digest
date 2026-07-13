import { z } from 'zod';

/**
 * Case Editor Files input tab — NEW shared contract file
 * (SPEC-2026-07-13-case-editor-files-tab).
 *
 * This EXTENDS the barrel with a new file; it does NOT edit the barrel's
 * existing exports. It gives the dormant `input_files` field on the write
 * (`EvalCaseInput`, eval-ci.ts) and read (`EvalCase`, knowledge.ts) contracts a
 * concrete element type (AC-16/AC-17).
 *
 * An `EvalCaseFile` is an add-only file: at run/preview time an array of these
 * is synthesized into a single unified diff (each file a newly ADDED file) that
 * the review engine already consumes. `path` and `content` are plain strings —
 * the non-empty/whitespace-path and uniqueness rules (AC-12/AC-13) are enforced
 * in the eval SERVICE (as `ValidationError`) and the client `validateFiles`
 * guard, NOT as Zod refinements here, keeping the reusable contract minimal (A2).
 */
export const EvalCaseFile = z.object({
  path: z.string(),
  content: z.string(),
});
export type EvalCaseFile = z.infer<typeof EvalCaseFile>;
