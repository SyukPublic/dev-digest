import { describe, it, expect } from 'vitest';
import { mergeSpecPaths, normalizeRepoPath } from '../src/modules/project-context/service.js';

/**
 * T10 (AC-6) — the pure merge/dedup resolver is the ORDERING AUTHORITY:
 *   1. agent-attached paths first, in stored order;
 *   2. then skill-inherited paths — each enabled skill's list in order, skills
 *      already in the agent's skill order;
 *   3. deduped by NORMALIZED repo-relative path, FIRST occurrence wins (the
 *      first-seen original string is preserved).
 * No DB, no I/O — the AC-6 spec lives here.
 */
describe('mergeSpecPaths (T10, AC-6)', () => {
  it('agent-attached come first, in stored order', () => {
    const out = mergeSpecPaths(['specs/a.md', 'docs/b.md'], []);
    expect(out).toEqual(['specs/a.md', 'docs/b.md']);
  });

  it('skill-inherited follow agent docs — skill order, then doc order', () => {
    const out = mergeSpecPaths(
      ['specs/agent.md'],
      [
        ['docs/skill1-a.md', 'docs/skill1-b.md'], // skill #1 (first in agent order)
        ['docs/skill2-a.md'], // skill #2
      ],
    );
    expect(out).toEqual([
      'specs/agent.md',
      'docs/skill1-a.md',
      'docs/skill1-b.md',
      'docs/skill2-a.md',
    ]);
  });

  it('dedups by normalized path, FIRST occurrence wins (agent beats skill)', () => {
    const out = mergeSpecPaths(
      ['specs/shared.md'],
      [['specs/shared.md', 'docs/only-skill.md']],
    );
    // specs/shared.md appears once (from the agent), the skill copy dropped;
    // the unique skill doc still follows.
    expect(out).toEqual(['specs/shared.md', 'docs/only-skill.md']);
  });

  it('dedups a doc shared across two skills — first skill wins', () => {
    const out = mergeSpecPaths(
      [],
      [['docs/common.md'], ['docs/common.md', 'docs/two.md']],
    );
    expect(out).toEqual(['docs/common.md', 'docs/two.md']);
  });

  it('normalizes only the DEDUP KEY — the original path string is preserved', () => {
    const out = mergeSpecPaths(['specs/a.md'], [['./specs/a.md', 'docs//b.md']]);
    // ./specs/a.md normalizes to specs/a.md (dedup key) → dropped as a dupe of
    // the agent's specs/a.md; docs//b.md is kept VERBATIM (only its key is
    // normalized), because that original string is what gets read/injected.
    expect(out).toEqual(['specs/a.md', 'docs//b.md']);
  });

  it('drops empty/blank paths', () => {
    const out = mergeSpecPaths(['', '  '], [['specs/real.md']]);
    expect(out).toEqual(['specs/real.md']);
  });

  it('empty inputs → empty output (no-specs baseline)', () => {
    expect(mergeSpecPaths([], [])).toEqual([]);
    expect(mergeSpecPaths([], [[], []])).toEqual([]);
  });
});

describe('normalizeRepoPath', () => {
  it('collapses backslashes, leading ./, leading / and duplicate slashes', () => {
    expect(normalizeRepoPath('docs\\a.md')).toBe('docs/a.md');
    expect(normalizeRepoPath('./docs/a.md')).toBe('docs/a.md');
    expect(normalizeRepoPath('/docs/a.md')).toBe('docs/a.md');
    expect(normalizeRepoPath('docs//a.md')).toBe('docs/a.md');
    expect(normalizeRepoPath('  docs/a.md  ')).toBe('docs/a.md');
  });

  it('preserves case (repo paths are case-sensitive)', () => {
    expect(normalizeRepoPath('Docs/A.md')).toBe('Docs/A.md');
  });
});
