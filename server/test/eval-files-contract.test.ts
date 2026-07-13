import { describe, it, expect } from 'vitest';
import { EvalCaseFile, EvalCaseInput, EvalCase } from '@devdigest/shared';

/**
 * test_eval_files_contract — T1/T2, AC-16/AC-17.
 *
 * The NEW `EvalCaseFile` shape and the additively-typed `input_files` field on
 * the write (`EvalCaseInput`) and read (`EvalCase`) contracts.
 */
describe('EvalCaseFile contract — T1 / AC-17', () => {
  it('accepts a plain { path, content } file', () => {
    const parsed = EvalCaseFile.safeParse({ path: 'src/config.ts', content: 'a\nb\nc' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ path: 'src/config.ts', content: 'a\nb\nc' });
    }
  });

  it('accepts an empty-content file (author-time emptiness is allowed)', () => {
    expect(EvalCaseFile.safeParse({ path: 'e.ts', content: '' }).success).toBe(true);
  });

  it('rejects non-string / missing path or content', () => {
    expect(EvalCaseFile.safeParse({ path: 'a.ts' }).success).toBe(false);
    expect(EvalCaseFile.safeParse({ path: 1, content: 'x' }).success).toBe(false);
    expect(EvalCaseFile.safeParse({ content: 'x' }).success).toBe(false);
  });
});

describe('EvalCaseInput.input_files — write contract, T2 / AC-16', () => {
  const base = {
    owner_kind: 'agent' as const,
    owner_id: 'agent-1',
    name: 'case',
    input_diff: '',
    expected_output: { expectation: 'must_not_flag', findings: [] },
  };

  it('accepts a typed array of files', () => {
    const parsed = EvalCaseInput.safeParse({
      ...base,
      input_files: [{ path: 'a.ts', content: 'x' }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.input_files).toEqual([{ path: 'a.ts', content: 'x' }]);
    }
  });

  it('is nullish — accepts null, undefined, and an empty array (legacy rows)', () => {
    expect(EvalCaseInput.safeParse({ ...base, input_files: null }).success).toBe(true);
    expect(EvalCaseInput.safeParse({ ...base }).success).toBe(true);
    expect(EvalCaseInput.safeParse({ ...base, input_files: [] }).success).toBe(true);
  });

  it('rejects malformed file elements', () => {
    expect(
      EvalCaseInput.safeParse({ ...base, input_files: [{ path: 'a.ts' }] }).success,
    ).toBe(false);
  });
});

describe('EvalCase.input_files — read contract, T2 / AC-16', () => {
  const base = {
    id: 'case-1',
    owner_kind: 'skill' as const,
    owner_id: 'skill-1',
    name: 'case',
    input_diff: '',
    input_meta: null,
    expected_output: null,
  };

  it('accepts a typed array of files', () => {
    expect(
      EvalCase.safeParse({ ...base, input_files: [{ path: 'a.ts', content: 'x' }] }).success,
    ).toBe(true);
  });

  it('is nullable — accepts an explicit null (legacy rows) but NOT undefined', () => {
    expect(EvalCase.safeParse({ ...base, input_files: null }).success).toBe(true);
    expect(EvalCase.safeParse({ ...base }).success).toBe(false);
  });
});
