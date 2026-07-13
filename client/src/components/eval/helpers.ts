/** Pure, shared helpers for the eval UI (formatting + client-side envelope guard). */
import type { EvalExpectedOutput, EvalExpectation } from "@devdigest/shared";

/** Render a 0..1 metric as a percent, or "—" when null/undefined (AC-18). */
export function fmtPct(n: number | null | undefined): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}

/** Render a signed 0..1 delta as "+Npt"/"-Npt", or "" when null. */
export function fmtDeltaPts(delta: number | null | undefined): string {
  if (delta == null) return "";
  const pts = Math.round(delta * 100);
  const sign = pts > 0 ? "+" : "";
  return `${sign}${pts}pt${Math.abs(pts) === 1 ? "" : "s"}`;
}

export type Direction = "up" | "down" | "flat";
export function deltaDirection(delta: number | null | undefined): Direction {
  if (delta == null || delta === 0) return "flat";
  return delta > 0 ? "up" : "down";
}

export interface EnvelopeValidation {
  ok: boolean;
  value?: EvalExpectedOutput;
  error?: string;
}

/**
 * Local `JSON.parse` + lightweight shape guard for the Save gate (AC-31, review
 * finding #3): the client imports contracts TYPE-ONLY, so it cannot run the Zod
 * schema — the server 422 is the authoritative validation. This just enables the
 * valid/invalid indicator + Save-blocking.
 */
export function validateEnvelope(text: string): EnvelopeValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "expected a JSON object" };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.expectation !== "must_find" && obj.expectation !== "must_not_flag") {
    return { ok: false, error: "expectation must be must_find | must_not_flag" };
  }
  if (!Array.isArray(obj.findings)) {
    return { ok: false, error: "findings must be an array" };
  }
  for (const f of obj.findings) {
    if (!f || typeof f !== "object") return { ok: false, error: "each finding must be an object" };
    const ff = f as Record<string, unknown>;
    if (typeof ff.file !== "string") return { ok: false, error: "finding.file must be a string" };
    if (typeof ff.start_line !== "number" || typeof ff.end_line !== "number") {
      return { ok: false, error: "finding.start_line / end_line must be numbers" };
    }
  }
  return { ok: true, value: parsed as EvalExpectedOutput };
}

/** A blank finding row inserted by the "+ Finding skeleton" button. */
export const FINDING_SKELETON = {
  file: "src/file.ts",
  start_line: 1,
  end_line: 1,
  severity: "WARNING",
  category: "bug",
  title: "",
};

/** Default envelope text seeded into a fresh Case Editor. */
export function defaultEnvelopeText(expectation: EvalExpectation = "must_find"): string {
  return JSON.stringify({ expectation, findings: [] }, null, 2);
}

/**
 * An add-only case file. Structural twin of the `@devdigest/shared` `EvalCaseFile`
 * contract (the client imports contracts TYPE-ONLY, so this is a local shape, not a
 * value-import of the Zod schema).
 */
export interface EvalFile {
  path: string;
  content: string;
}

/**
 * Synthesize an add-only unified diff: each file is a newly ADDED file (AC-7/AC-10).
 * CLIENT twin of `server/src/lib/diff-synth.ts` — the two implementations MUST produce
 * byte-identical output (verified against the shared C12 golden fixtures). Kept as the
 * same body so the read-only Diff-tab preview matches exactly what runs on the server.
 */
export function synthesizeAddedFilesDiff(files: EvalFile[]): string {
  return files.map(fileBlock).join("\n");
}

function fileBlock(f: EvalFile): string {
  const header = [`diff --git a/${f.path} b/${f.path}`, `--- /dev/null`, `+++ b/${f.path}`];
  if (f.content === "") return header.join("\n"); // AC-14: header, NO hunk / added lines
  const lines = f.content.split("\n"); // N = lines.length; trailing '\n' ⇒ trailing empty added line
  return [...header, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n");
}

export interface FilesValidation {
  ok: boolean;
  error?: string;
  duplicatePath?: string;
}

/**
 * Save-gate guard for the Files tab (AC-12/AC-13). Rejects any file with an
 * empty/whitespace-only path (AC-13) and any duplicate path (AC-12, echoed back via
 * `duplicatePath` so the UI can name it). Mirrors the lightweight `validateEnvelope`
 * pattern; empty CONTENT is allowed (author-time emptiness, AC-14).
 */
export function validateFiles(files: EvalFile[]): FilesValidation {
  const seen = new Set<string>();
  for (const f of files) {
    if (f.path.trim() === "") {
      return { ok: false, error: "emptyPath" };
    }
    if (seen.has(f.path)) {
      return { ok: false, error: "duplicatePath", duplicatePath: f.path };
    }
    seen.add(f.path);
  }
  return { ok: true };
}

export type DiffLineKind = "ctx" | "add" | "del";
export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/** Pure LCS line diff — the system-prompt diff block (Compare modal, AC-27). */
export function diffLines(a: string, b: string): DiffLine[] {
  const A = a.split("\n");
  const B = b.split("\n");
  const n = A.length;
  const m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = A[i] === B[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ kind: "ctx", text: A[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ kind: "del", text: A[i]! });
      i++;
    } else {
      out.push({ kind: "add", text: B[j]! });
      j++;
    }
  }
  while (i < n) out.push({ kind: "del", text: A[i++]! });
  while (j < m) out.push({ kind: "add", text: B[j++]! });
  return out;
}
