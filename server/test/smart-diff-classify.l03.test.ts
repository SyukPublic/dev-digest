import { describe, it, expect } from 'vitest';
import { classifyFile } from '../src/modules/smart-diff/classify.js';

/**
 * L03 verify target (`pnpm verify:l03`). Pure unit coverage for the deterministic
 * Smart Diff file classifier — NO Docker, NO DB, NO LLM. Independent of
 * smart-diff-classify.test.ts (that canonical suite is left untouched): cases are
 * parametrized via `it.each` so every classified path shows as its own line in the
 * runner output.
 *
 * Precedence: boilerplate > wiring > core (default). The size signal only breaks a
 * wiring tie toward core and never overrides a boilerplate match. A `.sql` migration
 * matches no pattern, so it falls through to `core`.
 */
describe('classifyFile', () => {
  it.each([
    { path: 'pnpm-lock.yaml', additions: 1, deletions: 0 },
    { path: 'package-lock.json', additions: 1, deletions: 0 },
    { path: 'yarn.lock', additions: 1, deletions: 0 },
    { path: 'dist/x.js', additions: 5, deletions: 2 },
    { path: 'build/main.js', additions: 5, deletions: 2 },
    { path: 'out/page.js', additions: 5, deletions: 2 },
    { path: 'client/.next/static/a.js', additions: 5, deletions: 2 },
    { path: '__snapshots__/a.snap', additions: 1, deletions: 0 },
    { path: 'test/__snapshots__/foo.test.ts.snap', additions: 1, deletions: 0 },
    { path: 'vendor/lib.min.js', additions: 1, deletions: 0 },
    { path: 'out/app.js.map', additions: 1, deletions: 0 },
    { path: 'src/schema.generated.ts', additions: 1, deletions: 0 },
    { path: 'node_modules/pkg/index.js', additions: 1, deletions: 0 },
  ])('classifies $path as boilerplate', ({ path, additions, deletions }) => {
    expect(classifyFile(path, additions, deletions)).toBe('boilerplate');
  });

  it.each([
    { path: 'next.config.ts', additions: 10, deletions: 0 },
    { path: 'vitest.config.ts', additions: 10, deletions: 0 },
    { path: 'server/src/index.ts', additions: 10, deletions: 0 },
    { path: 'tsconfig.json', additions: 5, deletions: 0 },
    { path: 'tsconfig.build.json', additions: 5, deletions: 0 },
    { path: '.eslintrc.json', additions: 5, deletions: 0 },
    { path: '.github/workflows/ci.yml', additions: 5, deletions: 0 },
    { path: 'server.ts', additions: 5, deletions: 0 },
    { path: 'src/app.tsx', additions: 5, deletions: 0 },
    { path: 'src/main.ts', additions: 5, deletions: 0 },
    { path: 'package.json', additions: 5, deletions: 0 },
    { path: '.gitignore', additions: 1, deletions: 0 },
  ])('classifies $path as wiring', ({ path, additions, deletions }) => {
    expect(classifyFile(path, additions, deletions)).toBe('wiring');
  });

  it.each([
    { path: 'server/src/modules/reviews/service.ts', additions: 30, deletions: 5 },
    { path: 'client/src/components/Button.tsx', additions: 12, deletions: 3 },
    { path: 'reviewer-core/src/review.ts', additions: 8, deletions: 1 },
    { path: '0001_migration.sql', additions: 40, deletions: 0 },
    { path: 'server/src/db/migrations/0002_init.sql', additions: 120, deletions: 0 },
  ])('classifies $path as core (the default)', ({ path, additions, deletions }) => {
    expect(classifyFile(path, additions, deletions)).toBe('core');
  });

  // Same logic, lower-cased path: an explicit pattern still matches.
  it('is case-insensitive: PNPM-LOCK.YAML → boilerplate', () => {
    expect(classifyFile('PNPM-LOCK.YAML', 1, 0)).toBe('boilerplate');
  });
  it('is case-insensitive: Server/Src/Index.TS → wiring', () => {
    expect(classifyFile('Server/Src/Index.TS', 1, 0)).toBe('wiring');
  });

  // Size signal breaks a wiring tie toward core, but never overrides boilerplate.
  it('size signal: server/src/index.ts (+10/-5) → wiring', () => {
    expect(classifyFile('server/src/index.ts', 10, 5)).toBe('wiring');
  });
  it('size signal: server/src/index.ts (+400/-0) → core', () => {
    expect(classifyFile('server/src/index.ts', 400, 0)).toBe('core');
  });
  it('size signal: pnpm-lock.yaml (+5000/-0) → boilerplate', () => {
    expect(classifyFile('pnpm-lock.yaml', 5000, 0)).toBe('boilerplate');
  });
});
