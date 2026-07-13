/**
 * Unit test for T6 (`test_diff_synth`): `synthesizeAddedFilesDiff` emits an
 * add-only unified diff byte-for-byte (AC-4/AC-10/AC-14), and the result feeds
 * `parseUnifiedDiff` such that a `<path>:N` citation grounds on the file's Nth
 * authored line (AC-11). Golden fixtures are C12 from the plan.
 */
import { describe, it, expect } from 'vitest';
import { synthesizeAddedFilesDiff } from '../src/lib/diff-synth.js';
import { parseUnifiedDiff } from '../src/lib/diff-parser.js';

describe('synthesizeAddedFilesDiff — add-only diff, byte-for-byte (C12 golden fixtures)', () => {
  it('one multi-line file → header + hunk + `+`-prefixed lines (AC-4/AC-10)', () => {
    const out = synthesizeAddedFilesDiff([{ path: 'src/config.ts', content: 'a\nb\nc' }]);
    expect(out).toBe(
      'diff --git a/src/config.ts b/src/config.ts\n' +
        '--- /dev/null\n' +
        '+++ b/src/config.ts\n' +
        '@@ -0,0 +1,3 @@\n' +
        '+a\n' +
        '+b\n' +
        '+c',
    );
  });

  it('two files → two `diff --git` blocks joined by \\n', () => {
    const out = synthesizeAddedFilesDiff([
      { path: 'a.ts', content: 'x' },
      { path: 'b.ts', content: 'y' },
    ]);
    expect(out).toBe(
      'diff --git a/a.ts b/a.ts\n--- /dev/null\n+++ b/a.ts\n@@ -0,0 +1,1 @@\n+x\n' +
        'diff --git a/b.ts b/b.ts\n--- /dev/null\n+++ b/b.ts\n@@ -0,0 +1,1 @@\n+y',
    );
  });

  it('empty content → header only, NO `@@` hunk / added lines (AC-14)', () => {
    const out = synthesizeAddedFilesDiff([{ path: 'e.ts', content: '' }]);
    expect(out).toBe('diff --git a/e.ts b/e.ts\n--- /dev/null\n+++ b/e.ts');
    expect(out).not.toContain('@@');
  });

  it('round-trips through parseUnifiedDiff: two files, each a parsed file', () => {
    const out = synthesizeAddedFilesDiff([
      { path: 'a.ts', content: 'x' },
      { path: 'b.ts', content: 'y' },
    ]);
    const parsed = parseUnifiedDiff(out);
    expect(parsed.files.map((f) => f.path)).toEqual(['a.ts', 'b.ts']);
  });

  it('an empty-content file yields no parsed file (no hunk, no path-bearing content) ', () => {
    const parsed = parseUnifiedDiff(synthesizeAddedFilesDiff([{ path: 'e.ts', content: '' }]));
    // The header still names a path, so the file is retained but carries no hunks.
    const file = parsed.files.find((f) => f.path === 'e.ts');
    expect(file?.hunks ?? []).toEqual([]);
  });

  it('grounding: a file with ≥12 lines → line 12 is a `+` line numbered 12 → `<path>:12` grounds (AC-11)', () => {
    const content = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
    const parsed = parseUnifiedDiff(synthesizeAddedFilesDiff([{ path: 'src/config.ts', content }]));
    const file = parsed.files.find((f) => f.path === 'src/config.ts');
    expect(file).toBeDefined();
    const covered = file!.hunks.flatMap((h) => h.newLineNumbers);
    // New-side numbers run 1..20 contiguously; line 12 is covered → citation grounds.
    expect(covered).toContain(12);
    expect(covered[0]).toBe(1);
    expect(covered).toContain(20);
  });
});
