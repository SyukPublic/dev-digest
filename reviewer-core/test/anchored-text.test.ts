/**
 * Unit tests for `anchoredText` (reviewer-core/src/grounding.ts).
 *
 * anchoredText is a pure function: Finding + UnifiedDiff → string | null.
 * It extracts the NEW-side text the finding anchors to (lines in
 * [min(start,end)..max], ascending), each right-trimmed, joined with '\n'.
 * No crypto/db/network — the server hashes the returned string identically on
 * write and read.
 *
 * Table:
 *  1. range covers part of a hunk → only those lines' text, in order
 *  2. determinism: same input → identical string
 *  3. trailing whitespace right-trimmed; indentation preserved
 *  4. file absent from diff → null
 *  5. range covers no parsed line → null
 *  6. newLineText absent (legacy diff) → null
 *  7. newLineText length mismatch → null
 *  8. added-file whole-file hunk → full text of the covered range
 */

import { describe, it, expect } from 'vitest';
import type { Finding, UnifiedDiff } from '@devdigest/shared';
import { anchoredText } from '../src/grounding.js';

/** One file, one hunk covering new-side lines 10–14 with aligned text. */
const DIFF: UnifiedDiff = {
  raw: '',
  files: [
    {
      path: 'src/service.ts',
      additions: 5,
      deletions: 0,
      hunks: [
        {
          file: 'src/service.ts',
          oldStart: 10,
          oldLines: 4,
          newStart: 10,
          newLines: 5,
          newLineNumbers: [10, 11, 12, 13, 14],
          newLineText: [
            '  const a = 1;',
            '  const b = 2;   ', // trailing whitespace → must be right-trimmed
            '  const c = 3;',
            '  const d = 4;',
            '  return a + b;',
          ],
        },
      ],
    },
  ],
};

function f(partial: Partial<Finding>): Finding {
  return {
    id: 'x',
    severity: 'WARNING',
    category: 'bug',
    title: 't',
    file: 'src/service.ts',
    start_line: 11,
    end_line: 12,
    rationale: 'r',
    confidence: 0.8,
    kind: 'finding',
    ...partial,
  };
}

describe('anchoredText', () => {
  it('extracts only the covered lines, in ascending line-number order', () => {
    const text = anchoredText(f({ start_line: 11, end_line: 12 }), DIFF);
    expect(text).toBe('  const b = 2;\n  const c = 3;');
  });

  it('is deterministic — identical input yields identical text', () => {
    const finding = f({ start_line: 10, end_line: 14 });
    expect(anchoredText(finding, DIFF)).toBe(anchoredText(finding, DIFF));
  });

  it('right-trims trailing whitespace but keeps leading indentation', () => {
    const text = anchoredText(f({ start_line: 11, end_line: 11 }), DIFF);
    expect(text).toBe('  const b = 2;'); // trailing spaces gone, indent kept
  });

  it('orders by line number even when start > end (range is normalized)', () => {
    const text = anchoredText(f({ start_line: 12, end_line: 11 }), DIFF);
    expect(text).toBe('  const b = 2;\n  const c = 3;');
  });

  it('returns null when the finding file is absent from the diff', () => {
    expect(anchoredText(f({ file: 'src/gone.ts', start_line: 11, end_line: 12 }), DIFF)).toBeNull();
  });

  it('returns null when the range covers no parsed line', () => {
    expect(anchoredText(f({ start_line: 900, end_line: 905 }), DIFF)).toBeNull();
  });

  it('returns null when the hunk has no newLineText (legacy diff)', () => {
    const legacy: UnifiedDiff = {
      raw: '',
      files: [
        {
          path: 'src/service.ts',
          additions: 1,
          deletions: 0,
          hunks: [
            {
              file: 'src/service.ts',
              oldStart: 10,
              oldLines: 1,
              newStart: 10,
              newLines: 1,
              newLineNumbers: [10, 11],
              // newLineText omitted on purpose
            },
          ],
        },
      ],
    };
    expect(anchoredText(f({ start_line: 10, end_line: 11 }), legacy)).toBeNull();
  });

  it('returns null when newLineText length does not match newLineNumbers', () => {
    const mismatched: UnifiedDiff = {
      raw: '',
      files: [
        {
          path: 'src/service.ts',
          additions: 2,
          deletions: 0,
          hunks: [
            {
              file: 'src/service.ts',
              oldStart: 10,
              oldLines: 2,
              newStart: 10,
              newLines: 2,
              newLineNumbers: [10, 11],
              newLineText: ['only one'], // length mismatch
            },
          ],
        },
      ],
    };
    expect(anchoredText(f({ start_line: 10, end_line: 11 }), mismatched)).toBeNull();
  });

  it('handles an added-file whole-file hunk (all lines covered)', () => {
    const added: UnifiedDiff = {
      raw: '',
      files: [
        {
          path: 'src/new.ts',
          additions: 3,
          deletions: 0,
          hunks: [
            {
              file: 'src/new.ts',
              oldStart: 0,
              oldLines: 0,
              newStart: 1,
              newLines: 3,
              newLineNumbers: [1, 2, 3],
              newLineText: ['export const a = 1;', 'export const b = 2;', 'export const c = 3;'],
            },
          ],
        },
      ],
    };
    const text = anchoredText(f({ file: 'src/new.ts', start_line: 1, end_line: 3 }), added);
    expect(text).toBe('export const a = 1;\nexport const b = 2;\nexport const c = 3;');
  });
});
