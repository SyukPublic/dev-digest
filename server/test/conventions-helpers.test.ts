import { describe, it, expect } from 'vitest';
import {
  acceptedRuleKeys,
  adjustConfidence,
  dedupeDrafts,
  normalizeRule,
  verifyAndCorroborate,
  buildSymbolIndex,
  structuralOccurrences,
  semanticDedup,
  type ConventionDraft,
} from '../src/modules/conventions/helpers.js';
import type { AstGrep, ParsedSymbol } from '../src/adapters/astgrep/index.js';
import { STRUCTURAL_BOOST } from '../src/modules/conventions/constants.js';

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

// ── F3: structural corroboration (ast-grep) ──────────────────────────────────
function sym(name: string, kind: ParsedSymbol['kind'], exported = false): ParsedSymbol {
  return { name, kind, line: 1, exported, signature: null, endLine: 1 } as ParsedSymbol;
}
function fakeAstGrep(perFile: Record<string, ParsedSymbol[]>, throwOn: string[] = []): AstGrep {
  return {
    langForFile: (f: string) => (f.endsWith('.ts') ? ('ts' as never) : null),
    parseSymbols: (f: string) => {
      if (throwOn.includes(f)) throw new Error('parse boom');
      return perFile[f] ?? [];
    },
    parseReferences: () => [],
    parseInvocationHeads: () => [],
    parseImports: () => [],
  } as unknown as AstGrep;
}

describe('buildSymbolIndex (F3)', () => {
  it('skips unsupported-language files and files that throw on parse', () => {
    const contents = new Map([
      ['src/a.ts', 'x'],
      ['readme.md', 'x'], // langForFile → null → skipped
      ['src/bad.ts', 'x'], // parse throws → skipped
    ]);
    const idx = buildSymbolIndex(
      fakeAstGrep({ 'src/a.ts': [sym('foo', 'function', true)] }, ['src/bad.ts']),
      contents,
    );
    expect([...idx.keys()]).toEqual(['src/a.ts']);
  });
});

describe('structuralOccurrences (F3)', () => {
  const index = new Map<string, ParsedSymbol[]>([
    ['src/a.ts', [sym('foo', 'function', true), sym('bar', 'function', true), sym('Baz', 'class')]],
  ]);
  it('counts exported functions for an exported-function rule', () => {
    expect(
      structuralOccurrences('Exported functions must have explicit return types', index),
    ).toBe(2);
  });
  it('returns null when no structural keyword fires', () => {
    expect(structuralOccurrences('Prefer single quotes', index)).toBeNull();
  });
});

describe('verifyAndCorroborate structural boost (F3)', () => {
  const contents = new Map([['src/a.ts', 'export function foo() {}']]);
  const cand = {
    rule: 'Export functions from modules',
    category: 'structure',
    evidence_path: 'src/a.ts',
    evidence_snippet: 'export function foo() {}',
    confidence: 0.7,
  };
  it('adds STRUCTURAL_BOOST when the predicate matches >0 symbols', () => {
    const idx = new Map([['src/a.ts', [sym('foo', 'function', true)]]]);
    const base = verifyAndCorroborate(cand, contents)!;
    const boosted = verifyAndCorroborate(cand, contents, idx)!;
    expect(boosted.confidence).toBeCloseTo(Math.min(1, base.confidence + STRUCTURAL_BOOST));
  });
  it('does not boost when the predicate matches 0 symbols (no extra penalty)', () => {
    const idx = new Map([['src/a.ts', [sym('Baz', 'class')]]]);
    const base = verifyAndCorroborate(cand, contents)!;
    expect(verifyAndCorroborate(cand, contents, idx)!.confidence).toBe(base.confidence);
  });
});

// ── F4: semantic dedup (embeddings) ──────────────────────────────────────────
describe('semanticDedup (F4)', () => {
  const draft = (
    rule: string,
    source: ConventionDraft['source'],
    confidence: number,
  ): ConventionDraft => ({
    rule,
    category: 'formatting',
    evidencePath: 'p',
    evidenceSnippet: 's',
    confidence,
    source,
    occurrences: source === 'config' ? null : 1,
  });
  it('merges near-paraphrases (cos>threshold), keeping the higher confidence', () => {
    const drafts = [
      draft('Use single quotes', 'llm', 0.7),
      draft('Prefer single-quoted strings', 'llm', 0.9),
    ];
    const out = semanticDedup(drafts, [
      [1, 0],
      [0.99, 0.14],
    ], 0.92);
    expect(out).toHaveLength(1);
    expect(out[0]!.confidence).toBe(0.9);
  });
  it('keeps distant rules apart (cos<threshold)', () => {
    const drafts = [draft('Use single quotes', 'llm', 0.7), draft('Use tabs', 'llm', 0.8)];
    expect(
      semanticDedup(drafts, [
        [1, 0],
        [0, 1],
      ], 0.92),
    ).toHaveLength(2);
  });
  it('config wins inside a cluster', () => {
    const drafts = [draft('use single quotes', 'llm', 0.95), draft('Use single quotes', 'config', 1.0)];
    const out = semanticDedup(drafts, [
      [1, 0],
      [0.999, 0.04],
    ], 0.92);
    expect(out).toHaveLength(1);
    expect(out[0]!.source).toBe('config');
    expect(out[0]!.confidence).toBe(1.0);
  });
  it('is a no-op for n<=1 or a vector/draft length mismatch', () => {
    const one = [draft('x', 'llm', 0.7)];
    expect(semanticDedup(one, [[1]], 0.92)).toBe(one);
    const two = [draft('x', 'llm', 0.7), draft('y', 'llm', 0.7)];
    expect(semanticDedup(two, [[1, 0]], 0.92)).toBe(two); // mismatch → input
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
