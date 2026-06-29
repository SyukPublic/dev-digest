import { describe, it, expect } from 'vitest';
import type { Finding } from '@devdigest/shared';
import { groundFindings, groundingSummary } from '../src/platform/grounding.js';
import { parseUnifiedDiff } from '../src/lib/diff-parser.js';

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,
diff --git a/src/api/users.ts b/src/api/users.ts
--- a/src/api/users.ts
+++ b/src/api/users.ts
@@ -44,2 +44,6 @@
   const users = await db.users.findMany();
+  for (const u of users) {
+    const posts = await db.posts.findMany({ userId: u.id });
+    result.push({ ...u, posts });
+  }`;

function f(partial: Partial<Finding>): Finding {
  return {
    id: 'x',
    severity: 'WARNING',
    category: 'bug',
    title: 't',
    file: 'src/config.ts',
    start_line: 12,
    end_line: 12,
    rationale: 'r',
    confidence: 0.8,
    ...partial,
  };
}

describe('citation grounding gate', () => {
  const diff = parseUnifiedDiff(DIFF);

  it('keeps a finding whose line intersects a real hunk', () => {
    const res = groundFindings([f({ file: 'src/config.ts', start_line: 12, end_line: 12 })], diff);
    expect(res.kept).toHaveLength(1);
    expect(res.dropped).toHaveLength(0);
  });

  it('drops a finding whose line does NOT intersect any hunk', () => {
    const res = groundFindings(
      [f({ file: 'src/config.ts', start_line: 999, end_line: 999 })],
      diff,
    );
    expect(res.kept).toHaveLength(0);
    expect(res.dropped[0]!.reason).toMatch(/do not intersect/);
  });

  it('drops a finding whose file is not in the diff', () => {
    const res = groundFindings([f({ file: 'src/not-here.ts' })], diff);
    expect(res.kept).toHaveLength(0);
    expect(res.dropped[0]!.reason).toMatch(/not present in diff/);
  });

  it('full-file kinds (secret_leak) ground against the file, not a hunk', () => {
    const res = groundFindings(
      [f({ file: 'src/config.ts', start_line: 1, end_line: 1, kind: 'secret_leak' })],
      diff,
    );
    expect(res.kept).toHaveLength(1);
  });

  it('range intersection across N+1 hunk lines', () => {
    const res = groundFindings(
      [f({ file: 'src/api/users.ts', start_line: 45, end_line: 52, category: 'perf' })],
      diff,
    );
    expect(res.kept).toHaveLength(1);
  });

  it('groundingSummary reports kept/total', () => {
    const res = groundFindings(
      [
        f({ file: 'src/config.ts', start_line: 12, end_line: 12 }),
        f({ file: 'src/config.ts', start_line: 999, end_line: 999 }),
      ],
      diff,
    );
    expect(groundingSummary(res)).toBe('1/2 passed');
  });
});

describe('unified diff parser', () => {
  it('extracts files and new-side line numbers', () => {
    const diff = parseUnifiedDiff(DIFF);
    expect(diff.files.map((f) => f.path)).toEqual(['src/config.ts', 'src/api/users.ts']);
    const config = diff.files[0]!;
    expect(config.additions).toBe(1);
    expect(config.hunks[0]!.newLineNumbers).toContain(11); // the added stripeKey line
  });

  it('retains new-side line TEXT aligned 1:1 with newLineNumbers, marker stripped', () => {
    const diff = parseUnifiedDiff(DIFF);
    const hunk = diff.files[0]!.hunks[0]!;
    // text array exists and is exactly as long as the number array
    expect(hunk.newLineText).toBeDefined();
    expect(hunk.newLineText!.length).toBe(hunk.newLineNumbers.length);
    // index of new line 11 → the added stripeKey line, with NO leading '+'
    const idx = hunk.newLineNumbers.indexOf(11);
    expect(hunk.newLineText![idx]).toBe('  stripeKey: "sk_live_xxx",');
    // a context line keeps its content with the leading space stripped
    const ctxIdx = hunk.newLineNumbers.indexOf(10);
    expect(hunk.newLineText![ctxIdx]).toBe('  port: 3000,');
  });

  it('captures text for every line of an added-file whole-file hunk', () => {
    const added = `diff --git a/src/new.ts b/src/new.ts
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,3 @@
+export const a = 1;
+export const b = 2;
+export const c = 3;`;
    const diff = parseUnifiedDiff(added);
    const hunk = diff.files[0]!.hunks[0]!;
    expect(hunk.newLineNumbers).toEqual([1, 2, 3]);
    expect(hunk.newLineText).toEqual([
      'export const a = 1;',
      'export const b = 2;',
      'export const c = 3;',
    ]);
  });
});
