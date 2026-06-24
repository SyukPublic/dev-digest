import { describe, it, expect } from 'vitest';
import {
  acceptedRuleKeys,
  adjustConfidence,
  dedupeDrafts,
  normalizeRule,
  verifyAndCorroborate,
  type ConventionDraft,
} from '../src/modules/conventions/helpers.js';

const contents = new Map<string, string>([
  ['src/a.ts', 'const x = await f();\nconst y = await g();'],
  ['src/b.ts', 'const z = await f();'],
]);

describe('verifyAndCorroborate', () => {
  it('keeps a candidate whose snippet exists on disk and counts occurrences', () => {
    const d = verifyAndCorroborate(
      { rule: 'Use await', category: 'async', evidence_path: 'src/a.ts', evidence_snippet: 'const x = await f();', confidence: 0.8 },
      contents,
    );
    expect(d).not.toBeNull();
    expect(d!.source).toBe('llm');
    expect(d!.occurrences).toBe(1); // anchor line appears only in src/a.ts
  });

  it('drops a hallucinated file path', () => {
    expect(
      verifyAndCorroborate(
        { rule: 'x', category: 'c', evidence_path: 'nope.ts', evidence_snippet: 'foo', confidence: 0.9 },
        contents,
      ),
    ).toBeNull();
  });

  it('drops a snippet whose anchor line is not in the cited file', () => {
    expect(
      verifyAndCorroborate(
        { rule: 'x', category: 'c', evidence_path: 'src/a.ts', evidence_snippet: 'never-here()', confidence: 0.9 },
        contents,
      ),
    ).toBeNull();
  });
});

describe('adjustConfidence', () => {
  it('boosts rules seen in >=2 files and penalizes singletons, clamped to [0,1]', () => {
    expect(adjustConfidence(0.8, 2)).toBeGreaterThan(0.8);
    expect(adjustConfidence(0.8, 1)).toBeLessThan(0.8);
    expect(adjustConfidence(0.99, 5)).toBeLessThanOrEqual(1);
  });
});

describe('dedupeDrafts', () => {
  it('lets a config rule win over an LLM restatement of the same rule', () => {
    const config: ConventionDraft[] = [
      { rule: 'Use single quotes', category: 'formatting', evidencePath: '.prettierrc', evidenceSnippet: 'x', confidence: 1, source: 'config', occurrences: null },
    ];
    const llm: ConventionDraft[] = [
      { rule: 'use single quotes', category: 'formatting', evidencePath: 'src/a.ts', evidenceSnippet: 'y', confidence: 0.7, source: 'llm', occurrences: 3 },
    ];
    const out = dedupeDrafts(config, llm);
    expect(out).toHaveLength(1);
    expect(out[0]!.source).toBe('config');
  });

  it('keeps distinct rules and sorts by category then confidence', () => {
    const llm: ConventionDraft[] = [
      { rule: 'B rule', category: 'zeta', evidencePath: 'a', evidenceSnippet: 's', confidence: 0.6, source: 'llm', occurrences: 2 },
      { rule: 'A rule', category: 'alpha', evidencePath: 'b', evidenceSnippet: 's', confidence: 0.9, source: 'llm', occurrences: 2 },
    ];
    const out = dedupeDrafts([], llm);
    expect(out).toHaveLength(2);
    expect(out[0]!.category).toBe('alpha');
  });
});

describe('normalizeRule', () => {
  it('maps different case, punctuation, and whitespace to the same key', () => {
    const variants = ['Use single quotes.', '  use single quotes  ', 'USE SINGLE QUOTES'];
    const keys = variants.map(normalizeRule);
    expect(new Set(keys).size).toBe(1);
  });

  it('keeps semantically distinct rules distinct', () => {
    expect(normalizeRule('Use single quotes')).not.toBe(normalizeRule('Use double quotes'));
  });
});

describe('config-exempt corroboration', () => {
  it('config drafts pass dedupeDrafts without confidence adjustment', () => {
    const config: ConventionDraft[] = [
      {
        rule: 'Use tabs for indentation',
        category: 'formatting',
        evidencePath: '.editorconfig',
        evidenceSnippet: 'indent_style=tab',
        confidence: 1.0,
        source: 'config',
        occurrences: null,
      },
    ];
    const out = dedupeDrafts(config, []);
    expect(out).toHaveLength(1);
    expect(out[0]!.confidence).toBe(1.0);
    expect(out[0]!.source).toBe('config');
    expect(out[0]!.occurrences).toBeNull();
  });
});

describe('acceptedRuleKeys', () => {
  it('includes only accepted=true rows', () => {
    const keys = acceptedRuleKeys([
      { rule: 'Use await', accepted: true },
      { rule: 'Use tabs', accepted: false },
    ]);
    expect(keys.has('use await')).toBe(true);
    expect(keys.has('use tabs')).toBe(false);
    expect(keys.size).toBe(1);
  });

  it('normalises case and punctuation to the same key', () => {
    const keys = acceptedRuleKeys([{ rule: 'Use Single Quotes!', accepted: true }]);
    expect(keys.has('use single quotes')).toBe(true);
  });

  it('ignores empty and punctuation-only rules', () => {
    const keys = acceptedRuleKeys([
      { rule: '', accepted: true },
      { rule: '   ', accepted: true },
      { rule: '!!!', accepted: true },
    ]);
    expect(keys.size).toBe(0);
  });

  it('returns an empty Set for empty input', () => {
    expect(acceptedRuleKeys([]).size).toBe(0);
  });
});
