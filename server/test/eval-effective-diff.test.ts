/**
 * Unit tests for T7 (`test_effective_diff`) + T8 (`test_case_dto`): the diff-source
 * branch (`effectiveDiff` / `parseInputFiles`, AC-6/AC-8/AC-18) and the defensive
 * `caseRowToDto` narrowing (AC-16). Pure — no DB, no LLM.
 */
import { describe, it, expect } from 'vitest';
import type { EvalCaseRow } from '../src/db/rows.js';
import { parseInputFiles, effectiveDiff, caseRowToDto } from '../src/modules/eval/helpers.js';

const DIFF = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,3 @@\n a\n+b\n c\n';

function caseRow(overrides: Partial<EvalCaseRow> = {}): EvalCaseRow {
  return {
    id: 'case-1',
    workspaceId: 'ws-1',
    ownerKind: 'agent',
    ownerId: 'agent-1',
    name: 'a case',
    inputDiff: DIFF,
    inputFiles: null,
    inputMeta: null,
    expectedOutput: { expectation: 'must_find', findings: [] },
    notes: null,
    ...overrides,
  } as EvalCaseRow;
}

describe('parseInputFiles — narrow stored jsonb → EvalCaseFile[] | null (AC-16)', () => {
  it('a valid non-empty array parses to EvalCaseFile[]', () => {
    expect(parseInputFiles([{ path: 'a.ts', content: 'x' }])).toEqual([{ path: 'a.ts', content: 'x' }]);
  });

  it('null / empty array / non-array / malformed element all degrade to null', () => {
    expect(parseInputFiles(null)).toBeNull(); // legacy row
    expect(parseInputFiles([])).toBeNull(); // empty ⇒ fall back to diff
    expect(parseInputFiles('not-an-array')).toBeNull();
    expect(parseInputFiles([{ path: 1, content: 'x' }])).toBeNull(); // wrong element shape
    expect(parseInputFiles([{ path: 'a.ts' }])).toBeNull(); // missing content
  });
});

describe('effectiveDiff — files win over pasted diff, same UnifiedDiff shape (AC-6/AC-8/AC-18)', () => {
  it('files present ⇒ synthesized add-only diff (ignores input_diff) (AC-6)', () => {
    const diff = effectiveDiff(
      caseRow({ inputFiles: [{ path: 'src/config.ts', content: 'a\nb\nc' }], inputDiff: DIFF }),
    );
    expect(diff.files.map((f) => f.path)).toEqual(['src/config.ts']);
    // Add-only synthesis: three added lines numbered 1..3.
    const covered = diff.files[0]!.hunks.flatMap((h) => h.newLineNumbers);
    expect(covered).toEqual([1, 2, 3]);
  });

  it('no files ⇒ parses the pasted input_diff (AC-8)', () => {
    const diff = effectiveDiff(caseRow({ inputFiles: null, inputDiff: DIFF }));
    expect(diff.files.map((f) => f.path)).toEqual(['a.ts']);
  });

  it('no files and null diff ⇒ zero files (empty diff)', () => {
    const diff = effectiveDiff(caseRow({ inputFiles: null, inputDiff: null }));
    expect(diff.files).toEqual([]);
  });
});

describe('caseRowToDto — input_files surfaces EvalCaseFile[] | null (AC-16)', () => {
  it('a valid files row surfaces the parsed array', () => {
    const dto = caseRowToDto(caseRow({ inputFiles: [{ path: 'a.ts', content: 'x' }] }));
    expect(dto.input_files).toEqual([{ path: 'a.ts', content: 'x' }]);
  });

  it('a legacy null row surfaces null (no crash)', () => {
    expect(caseRowToDto(caseRow({ inputFiles: null })).input_files).toBeNull();
  });

  it('a MALFORMED legacy row degrades to null — no 500 (AC-16)', () => {
    expect(caseRowToDto(caseRow({ inputFiles: { not: 'an array' } })).input_files).toBeNull();
    expect(caseRowToDto(caseRow({ inputFiles: [{ path: 42 }] })).input_files).toBeNull();
  });
});
