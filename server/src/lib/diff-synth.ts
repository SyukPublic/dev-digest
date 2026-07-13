/**
 * Add-only unified-diff synthesizer — server PRODUCT logic (mirrors
 * `diff-parser.ts`), NOT reviewer-core, NOT an adapter. Turns a case's authored
 * `input_files` into an ordinary `git diff` string that `parseUnifiedDiff`
 * already consumes: each file is a newly ADDED file (`--- /dev/null` → `+++ b/…`),
 * so a citation on `<path>:N` grounds on the file's Nth authored line (AC-10/AC-11).
 *
 * Both this server twin and the client editor twin (Phase 2) MUST emit the exact
 * same string for the same input — keep the body byte-identical if you change it.
 */
export function synthesizeAddedFilesDiff(files: { path: string; content: string }[]): string {
  return files.map(fileBlock).join('\n');
}

function fileBlock(f: { path: string; content: string }): string {
  const header = [`diff --git a/${f.path} b/${f.path}`, `--- /dev/null`, `+++ b/${f.path}`];
  if (f.content === '') return header.join('\n'); // AC-14: header, NO hunk / added lines
  const lines = f.content.split('\n');
  return [...header, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join('\n');
}
