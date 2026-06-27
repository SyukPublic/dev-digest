/**
 * Unit tests for `anchorStatus` (reviewer-core/src/grounding.ts).
 *
 * anchorStatus is a pure function: Finding + UnifiedDiff → AnchorStatus.
 * No stubs required. Fixtures are minimal hand-built UnifiedDiff objects.
 *
 * Table:
 *  1. file absent from diff                          → 'orphaned'
 *  2. file present, range intersects a hunk          → 'current'
 *  3. file present, range does NOT intersect any hunk → 'moved_out'
 *  4. full-file kind (secret_leak) + file present, range NOT in hunk → 'current'
 *  5. kind null, range hits a hunk                   → 'current'
 */

import { describe, it, expect } from 'vitest';
import type { Finding, UnifiedDiff } from '@devdigest/shared';
import { anchorStatus } from '../src/grounding.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** Minimal `UnifiedDiff` with one file and one hunk covering new-side lines 10–14. */
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
        },
      ],
    },
  ],
};

/** Helper: build a minimal Finding with field overrides. */
function f(partial: Partial<Finding>): Finding {
  return {
    id: 'x',
    severity: 'WARNING',
    category: 'bug',
    title: 't',
    file: 'src/service.ts',
    start_line: 12,
    end_line: 12,
    rationale: 'r',
    confidence: 0.8,
    kind: 'finding',
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('anchorStatus', () => {
  // Unit under test : anchorStatus
  // Input           : finding on a file NOT in DIFF
  // Stubs           : none (pure)
  // Expected        : 'orphaned'
  it('returns orphaned when the finding file is absent from the diff', () => {
    const finding = f({ file: 'src/deleted.ts', start_line: 5, end_line: 5 });
    expect(anchorStatus(finding, DIFF)).toBe('orphaned');
  });

  // Unit under test : anchorStatus
  // Input           : finding on line 12 (inside hunk [10..14])
  // Stubs           : none (pure)
  // Expected        : 'current'
  it('returns current when the finding range intersects a hunk', () => {
    const finding = f({ file: 'src/service.ts', start_line: 12, end_line: 13 });
    expect(anchorStatus(finding, DIFF)).toBe('current');
  });

  // Unit under test : anchorStatus
  // Input           : finding on lines 20–22 (outside hunk [10..14])
  // Stubs           : none (pure)
  // Expected        : 'moved_out'
  it('returns moved_out when the finding range does not intersect any hunk', () => {
    const finding = f({ file: 'src/service.ts', start_line: 20, end_line: 22 });
    expect(anchorStatus(finding, DIFF)).toBe('moved_out');
  });

  // Unit under test : anchorStatus
  // Input           : full-file kind='secret_leak', file present, but range NOT in any hunk
  // Stubs           : none (pure)
  // Expected        : 'current' (full-file kinds only need the file to be in the diff)
  it('returns current for a secret_leak finding even when its range is outside every hunk', () => {
    const finding = f({
      file: 'src/service.ts',
      start_line: 999,
      end_line: 999,
      kind: 'secret_leak',
    });
    expect(anchorStatus(finding, DIFF)).toBe('current');
  });

  // Unit under test : anchorStatus
  // Input           : kind null, range 11–12 (inside hunk [10..14])
  // Stubs           : none (pure)
  // Expected        : 'current' (null kind is treated as a diff-finding, range check applies)
  it('returns current for kind=null when the range hits a hunk', () => {
    const finding = f({ file: 'src/service.ts', start_line: 11, end_line: 12, kind: null });
    expect(anchorStatus(finding, DIFF)).toBe('current');
  });

  // Round-trip: all remaining full-file kinds also satisfy the full-file gate.
  it.each(['lethal_trifecta', 'phantom', 'hook'] as const)(
    'returns current for full-file kind=%s with file present regardless of lines',
    (kind) => {
      const finding = f({ file: 'src/service.ts', start_line: 500, end_line: 500, kind });
      expect(anchorStatus(finding, DIFF)).toBe('current');
    },
  );
});
