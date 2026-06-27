import { describe, it, expect } from 'vitest';
import { SmartDiff } from '@devdigest/shared';
import { classifyFile } from '../src/modules/smart-diff/classify.js';
import { composeSmartDiff } from '../src/modules/smart-diff/compose.js';
import { SPLIT_TOO_BIG_LINES } from '../src/modules/smart-diff/constants.js';

/**
 * Pure unit coverage for the deterministic brain of Smart Diff. NO Docker, NO
 * DB, NO LLM. Also proves contract conformance via `SmartDiff.parse(...)`.
 */

describe('classifyFile', () => {
  it('classifies generated/lock/build/snapshot files as boilerplate', () => {
    expect(classifyFile('pnpm-lock.yaml', 1, 0)).toBe('boilerplate');
    expect(classifyFile('package-lock.json', 1, 0)).toBe('boilerplate');
    expect(classifyFile('yarn.lock', 1, 0)).toBe('boilerplate');
    expect(classifyFile('dist/x.js', 5, 2)).toBe('boilerplate');
    expect(classifyFile('build/main.js', 5, 2)).toBe('boilerplate');
    expect(classifyFile('out/page.js', 5, 2)).toBe('boilerplate');
    expect(classifyFile('client/.next/static/a.js', 5, 2)).toBe('boilerplate');
    expect(classifyFile('__snapshots__/a.snap', 1, 0)).toBe('boilerplate');
    expect(classifyFile('test/__snapshots__/foo.test.ts.snap', 1, 0)).toBe('boilerplate');
    expect(classifyFile('vendor/lib.min.js', 1, 0)).toBe('boilerplate');
    expect(classifyFile('out/app.js.map', 1, 0)).toBe('boilerplate');
    expect(classifyFile('src/schema.generated.ts', 1, 0)).toBe('boilerplate');
    expect(classifyFile('node_modules/pkg/index.js', 1, 0)).toBe('boilerplate');
  });

  it('classifies config + entry/barrel files as wiring', () => {
    expect(classifyFile('next.config.ts', 10, 0)).toBe('wiring');
    expect(classifyFile('vitest.config.ts', 10, 0)).toBe('wiring');
    expect(classifyFile('server/src/index.ts', 10, 0)).toBe('wiring');
    expect(classifyFile('tsconfig.json', 5, 0)).toBe('wiring');
    expect(classifyFile('tsconfig.build.json', 5, 0)).toBe('wiring');
    expect(classifyFile('.eslintrc.json', 5, 0)).toBe('wiring');
    expect(classifyFile('.github/workflows/ci.yml', 5, 0)).toBe('wiring');
    expect(classifyFile('server.ts', 5, 0)).toBe('wiring');
    expect(classifyFile('src/app.tsx', 5, 0)).toBe('wiring');
    expect(classifyFile('src/main.ts', 5, 0)).toBe('wiring');
    expect(classifyFile('package.json', 5, 0)).toBe('wiring');
    expect(classifyFile('.gitignore', 1, 0)).toBe('wiring');
  });

  it('classifies real logic files as core (the default)', () => {
    expect(classifyFile('server/src/modules/reviews/service.ts', 30, 5)).toBe('core');
    expect(classifyFile('client/src/components/Button.tsx', 12, 3)).toBe('core');
    expect(classifyFile('reviewer-core/src/review.ts', 8, 1)).toBe('core');
  });

  it('is case-insensitive on the path', () => {
    expect(classifyFile('PNPM-LOCK.YAML', 1, 0)).toBe('boilerplate');
    expect(classifyFile('Server/Src/Index.TS', 1, 0)).toBe('wiring');
  });

  it('size signal breaks a wiring tie toward core, but never overrides boilerplate', () => {
    // Small wiring entry file → wiring.
    expect(classifyFile('server/src/index.ts', 10, 5)).toBe('wiring');
    // Large wiring entry file (>300 changed lines) → core via the size signal.
    expect(classifyFile('server/src/index.ts', 400, 0)).toBe('core');
    // A huge lock file is still boilerplate — size never overrides an explicit pattern.
    expect(classifyFile('pnpm-lock.yaml', 5000, 0)).toBe('boilerplate');
  });
});

describe('composeSmartDiff', () => {
  const files = [
    { path: 'server/src/modules/reviews/service.ts', additions: 30, deletions: 5 }, // core
    { path: 'next.config.ts', additions: 4, deletions: 1 }, // wiring
    { path: 'pnpm-lock.yaml', additions: 100, deletions: 50 }, // boilerplate
  ];

  it('groups in core, wiring, boilerplate order and omits empty groups', () => {
    const result = composeSmartDiff(files, new Map());
    expect(result.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);

    // Only-core input → only the core group present (empties omitted).
    const coreOnly = composeSmartDiff(
      [{ path: 'src/logic.ts', additions: 3, deletions: 0 }],
      new Map(),
    );
    expect(coreOnly.groups.map((g) => g.role)).toEqual(['core']);
    expect(SmartDiff.parse(coreOnly)).toBeTruthy();
  });

  it('attaches sorted + de-duped finding_lines per path and sets pseudocode_summary null', () => {
    const map = new Map<string, number[]>([
      ['server/src/modules/reviews/service.ts', [12, 10, 12, 11]],
    ]);
    const result = composeSmartDiff(files, map);
    const coreFile = result.groups.find((g) => g.role === 'core')!.files[0]!;
    expect(coreFile.finding_lines).toEqual([10, 11, 12]);
    expect(coreFile.pseudocode_summary).toBeNull();

    // A path with no findings → [].
    const wiringFile = result.groups.find((g) => g.role === 'wiring')!.files[0]!;
    expect(wiringFile.finding_lines).toEqual([]);
  });

  it('with no findings every finding_lines is [] and pseudocode_summary stays null', () => {
    const result = composeSmartDiff(files, new Map());
    for (const group of result.groups) {
      for (const f of group.files) {
        expect(f.finding_lines).toEqual([]);
        expect(f.pseudocode_summary).toBeNull();
      }
    }
  });

  it('computes total_lines as the additions+deletions sum', () => {
    const result = composeSmartDiff(files, new Map());
    // (30+5) + (4+1) + (100+50) = 190
    expect(result.split_suggestion.total_lines).toBe(190);
  });

  it('toggles too_big exactly at the threshold boundary', () => {
    const atThreshold = composeSmartDiff(
      [{ path: 'src/big.ts', additions: SPLIT_TOO_BIG_LINES, deletions: 0 }],
      new Map(),
    );
    expect(atThreshold.split_suggestion.total_lines).toBe(SPLIT_TOO_BIG_LINES);
    expect(atThreshold.split_suggestion.too_big).toBe(false); // strictly greater than

    const overThreshold = composeSmartDiff(
      [{ path: 'src/big.ts', additions: SPLIT_TOO_BIG_LINES + 1, deletions: 0 }],
      new Map(),
    );
    expect(overThreshold.split_suggestion.too_big).toBe(true);
  });

  it('proposes splits by top-level dir only when too_big AND ≥2 distinct top-level dirs', () => {
    // Too big, but a single top-level dir → no splits.
    const oneDir = composeSmartDiff(
      [{ path: 'server/a.ts', additions: 600, deletions: 0 }],
      new Map(),
    );
    expect(oneDir.split_suggestion.too_big).toBe(true);
    expect(oneDir.split_suggestion.proposed_splits).toEqual([]);

    // Too big AND two top-level dirs → grouped splits.
    const twoDirs = composeSmartDiff(
      [
        { path: 'server/a.ts', additions: 400, deletions: 0 },
        { path: 'client/b.ts', additions: 300, deletions: 0 },
      ],
      new Map(),
    );
    expect(twoDirs.split_suggestion.too_big).toBe(true);
    const splitNames = twoDirs.split_suggestion.proposed_splits.map((s) => s.name).sort();
    expect(splitNames).toEqual(['client', 'server']);
    const serverSplit = twoDirs.split_suggestion.proposed_splits.find((s) => s.name === 'server')!;
    expect(serverSplit.files).toEqual(['server/a.ts']);

    // Not too big → no splits even with multiple dirs.
    const small = composeSmartDiff(
      [
        { path: 'server/a.ts', additions: 1, deletions: 0 },
        { path: 'client/b.ts', additions: 1, deletions: 0 },
      ],
      new Map(),
    );
    expect(small.split_suggestion.proposed_splits).toEqual([]);
  });

  it('handles zero files → empty groups, total_lines 0, too_big false', () => {
    const result = composeSmartDiff([], new Map());
    expect(result.groups).toEqual([]);
    expect(result.split_suggestion.total_lines).toBe(0);
    expect(result.split_suggestion.too_big).toBe(false);
    expect(result.split_suggestion.proposed_splits).toEqual([]);
    expect(SmartDiff.parse(result)).toBeTruthy();
  });

  it('round-trips the SmartDiff contract (no extra keys, all shapes valid)', () => {
    const map = new Map<string, number[]>([
      ['server/src/modules/reviews/service.ts', [1, 2, 3]],
    ]);
    const result = composeSmartDiff(files, map);
    const parsed = SmartDiff.parse(result);
    expect(parsed).toEqual(result);
    // strict round-trip: no surprise keys on files
    expect(Object.keys(parsed.groups[0]!.files[0]!).sort()).toEqual(
      ['additions', 'deletions', 'finding_lines', 'path', 'pseudocode_summary'].sort(),
    );
  });
});
