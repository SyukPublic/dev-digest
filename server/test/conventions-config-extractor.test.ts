import { describe, it, expect } from 'vitest';
import {
  extractConfigConventions,
  parseJsonc,
} from '../src/modules/conventions/config-extractor.js';

describe('extractConfigConventions (deterministic, no-LLM)', () => {
  it('derives the tsconfig strict rule with config source + full confidence', () => {
    const out = extractConfigConventions({
      'tsconfig.json': '{ "compilerOptions": { "strict": true } }',
    });
    expect(out.some((d) => d.rule.includes('strict mode'))).toBe(true);
    expect(out.every((d) => d.source === 'config' && d.confidence === 1)).toBe(true);
    expect(out.every((d) => d.occurrences === null)).toBe(true);
  });

  it('parses JSONC with comments and trailing commas', () => {
    const parsed = parseJsonc('{\n // a comment\n "compilerOptions": { "strict": true, },\n}') as {
      compilerOptions: { strict: boolean };
    };
    expect(parsed.compilerOptions.strict).toBe(true);
  });

  it('derives prettier quote + semicolon rules', () => {
    const out = extractConfigConventions({
      '.prettierrc.json': '{ "singleQuote": true, "semi": false }',
    });
    expect(out.some((d) => d.rule === 'Use single quotes')).toBe(true);
    expect(out.some((d) => d.rule === 'Omit semicolons')).toBe(true);
  });

  it('maps a curated eslint subset and ignores "off" rules', () => {
    const out = extractConfigConventions({
      '.eslintrc.json': JSON.stringify({ rules: { eqeqeq: 'error', 'no-console': 'off' } }),
    });
    expect(out.some((d) => d.rule.includes('=== instead of =='))).toBe(true);
    expect(out.some((d) => d.rule.toLowerCase().includes('console'))).toBe(false);
  });

  it('reads prettier config from package.json#prettier', () => {
    const out = extractConfigConventions({
      'package.json': JSON.stringify({ name: 'x', prettier: { singleQuote: false } }),
    });
    expect(out.some((d) => d.rule === 'Use double quotes')).toBe(true);
  });

  it('returns nothing for missing or unparseable files', () => {
    expect(extractConfigConventions({ 'tsconfig.json': null, 'package.json': 'not json' })).toEqual([]);
  });
});
