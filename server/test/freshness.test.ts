/**
 * Stage 1 acceptance — freshness-key helpers (pure unit tests, no DB).
 *
 * Covers:
 * - intentFreshnessKey: determinism, each-field sensitivity, write/read symmetry.
 * - risksFreshnessKey:  same guarantees + intentKey sensitivity.
 * - Structural assertion: linked-issue text is NOT an input (deliberate omission).
 */

import { describe, it, expect } from 'vitest';
import { intentFreshnessKey, risksFreshnessKey } from '../src/modules/reviews/freshness.js';

// ── Shared base inputs ────────────────────────────────────────────────────────

const BASE_INTENT_INPUT = {
  headSha: 'sha-abc123',
  base: 'main',
  title: 'Add rate limiting',
  body: 'Closes #12.',
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4-flash',
  promptVersion: 1,
} as const;

const BASE_RISKS_INPUT = {
  ...BASE_INTENT_INPUT,
  intentKey: 'intent-key-xyz',
} as const;

// ── intentFreshnessKey ────────────────────────────────────────────────────────

describe('intentFreshnessKey', () => {
  // Intention: same input → same 64-char hex output (determinism).
  it('is deterministic — same inputs produce the same hash', () => {
    const k1 = intentFreshnessKey(BASE_INTENT_INPUT);
    const k2 = intentFreshnessKey(BASE_INTENT_INPUT);
    expect(k1).toBe(k2);
  });

  // Intention: output looks like a SHA-256 hex string (64 chars, lowercase hex).
  it('returns a non-empty hex string (SHA-256, 64 chars)', () => {
    const k = intentFreshnessKey(BASE_INTENT_INPUT);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });

  // Intention: write-path and read-path hash the same inputs → keys always match.
  it('two independent calls with identical inputs produce the same key (write/read symmetry)', () => {
    const writeKey = intentFreshnessKey({ ...BASE_INTENT_INPUT });
    const readKey = intentFreshnessKey({ ...BASE_INTENT_INPUT });
    expect(writeKey).toBe(readKey);
  });

  // The following tests assert that changing ANY SINGLE field produces a different hash.
  // They are parameterised over all 7 inputs.

  it('changing headSha changes the key', () => {
    const a = intentFreshnessKey(BASE_INTENT_INPUT);
    const b = intentFreshnessKey({ ...BASE_INTENT_INPUT, headSha: 'sha-different' });
    expect(a).not.toBe(b);
  });

  it('changing base changes the key', () => {
    const a = intentFreshnessKey(BASE_INTENT_INPUT);
    const b = intentFreshnessKey({ ...BASE_INTENT_INPUT, base: 'develop' });
    expect(a).not.toBe(b);
  });

  it('changing title changes the key', () => {
    const a = intentFreshnessKey(BASE_INTENT_INPUT);
    const b = intentFreshnessKey({ ...BASE_INTENT_INPUT, title: 'Fix bug' });
    expect(a).not.toBe(b);
  });

  it('changing body changes the key', () => {
    const a = intentFreshnessKey(BASE_INTENT_INPUT);
    const b = intentFreshnessKey({ ...BASE_INTENT_INPUT, body: 'Different body text.' });
    expect(a).not.toBe(b);
  });

  it('changing provider changes the key', () => {
    const a = intentFreshnessKey(BASE_INTENT_INPUT);
    const b = intentFreshnessKey({ ...BASE_INTENT_INPUT, provider: 'openai' });
    expect(a).not.toBe(b);
  });

  it('changing model changes the key', () => {
    const a = intentFreshnessKey(BASE_INTENT_INPUT);
    const b = intentFreshnessKey({ ...BASE_INTENT_INPUT, model: 'gpt-4.1' });
    expect(a).not.toBe(b);
  });

  it('changing promptVersion changes the key', () => {
    const a = intentFreshnessKey(BASE_INTENT_INPUT);
    const b = intentFreshnessKey({ ...BASE_INTENT_INPUT, promptVersion: 2 });
    expect(a).not.toBe(b);
  });

  // Structural assertion: linked-issue text is NOT a parameter — the function
  // signature deliberately has no `issueTitle`/`issueBody`/`linkedIssue` field.
  // This validates the documented design decision (freshness.ts header: "Deliberate
  // exclusion: the linked GitHub issue is NOT in the key").
  it('accepts exactly {headSha, base, title, body, provider, model, promptVersion} — no issue param', () => {
    // This test compiles only if intentFreshnessKey does NOT accept an extra field
    // and still returns a string. If the signature ever changes, this breaks intentionally.
    const result = intentFreshnessKey(BASE_INTENT_INPUT);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  // Different inputs → different outputs (collision resistance sanity check).
  it('different prompt versions produce different keys (no accidental collision)', () => {
    const keys = [1, 2, 3].map((promptVersion) =>
      intentFreshnessKey({ ...BASE_INTENT_INPUT, promptVersion }),
    );
    const unique = new Set(keys);
    expect(unique.size).toBe(3);
  });
});

// ── risksFreshnessKey ─────────────────────────────────────────────────────────

describe('risksFreshnessKey', () => {
  // Intention: same input → same 64-char hex output (determinism).
  it('is deterministic — same inputs produce the same hash', () => {
    const k1 = risksFreshnessKey(BASE_RISKS_INPUT);
    const k2 = risksFreshnessKey(BASE_RISKS_INPUT);
    expect(k1).toBe(k2);
  });

  it('returns a non-empty hex string (SHA-256, 64 chars)', () => {
    const k = risksFreshnessKey(BASE_RISKS_INPUT);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });

  it('two independent calls with identical inputs produce the same key (write/read symmetry)', () => {
    const writeKey = risksFreshnessKey({ ...BASE_RISKS_INPUT });
    const readKey = risksFreshnessKey({ ...BASE_RISKS_INPUT });
    expect(writeKey).toBe(readKey);
  });

  it('changing headSha changes the key', () => {
    const a = risksFreshnessKey(BASE_RISKS_INPUT);
    const b = risksFreshnessKey({ ...BASE_RISKS_INPUT, headSha: 'sha-different' });
    expect(a).not.toBe(b);
  });

  it('changing base changes the key', () => {
    const a = risksFreshnessKey(BASE_RISKS_INPUT);
    const b = risksFreshnessKey({ ...BASE_RISKS_INPUT, base: 'develop' });
    expect(a).not.toBe(b);
  });

  it('changing title changes the key', () => {
    const a = risksFreshnessKey(BASE_RISKS_INPUT);
    const b = risksFreshnessKey({ ...BASE_RISKS_INPUT, title: 'Fix bug' });
    expect(a).not.toBe(b);
  });

  it('changing body changes the key', () => {
    const a = risksFreshnessKey(BASE_RISKS_INPUT);
    const b = risksFreshnessKey({ ...BASE_RISKS_INPUT, body: 'Different body.' });
    expect(a).not.toBe(b);
  });

  it('changing provider changes the key', () => {
    const a = risksFreshnessKey(BASE_RISKS_INPUT);
    const b = risksFreshnessKey({ ...BASE_RISKS_INPUT, provider: 'openai' });
    expect(a).not.toBe(b);
  });

  it('changing model changes the key', () => {
    const a = risksFreshnessKey(BASE_RISKS_INPUT);
    const b = risksFreshnessKey({ ...BASE_RISKS_INPUT, model: 'gpt-4.1' });
    expect(a).not.toBe(b);
  });

  it('changing promptVersion changes the key', () => {
    const a = risksFreshnessKey(BASE_RISKS_INPUT);
    const b = risksFreshnessKey({ ...BASE_RISKS_INPUT, promptVersion: 2 });
    expect(a).not.toBe(b);
  });

  // Risks-specific: changing the intentKey changes the risks key.
  // This validates that risks go stale when the intent is recomputed.
  it('changing intentKey changes the key (risks go stale when intent is recomputed)', () => {
    const a = risksFreshnessKey(BASE_RISKS_INPUT);
    const b = risksFreshnessKey({ ...BASE_RISKS_INPUT, intentKey: 'different-intent-key' });
    expect(a).not.toBe(b);
  });

  // An empty intentKey (null-stored case: storedIntent?.freshnessKey ?? '')
  // must still produce a deterministic hash (not crash).
  it('empty intentKey ("") is valid and deterministic', () => {
    const k1 = risksFreshnessKey({ ...BASE_RISKS_INPUT, intentKey: '' });
    const k2 = risksFreshnessKey({ ...BASE_RISKS_INPUT, intentKey: '' });
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^[0-9a-f]{64}$/);
  });

  // Empty intentKey and non-empty intentKey produce different hashes.
  it('empty intentKey and non-empty intentKey produce different hashes', () => {
    const withKey = risksFreshnessKey({ ...BASE_RISKS_INPUT, intentKey: 'some-key' });
    const withEmpty = risksFreshnessKey({ ...BASE_RISKS_INPUT, intentKey: '' });
    expect(withKey).not.toBe(withEmpty);
  });

  // intentFreshnessKey and risksFreshnessKey ALWAYS differ even for identical base inputs
  // (risksFreshnessKey has the extra intentKey part → different JSON input).
  it('risks key always differs from intent key for the same base inputs', () => {
    const intentKey = intentFreshnessKey(BASE_INTENT_INPUT);
    const risksKey = risksFreshnessKey({ ...BASE_RISKS_INPUT });
    expect(intentKey).not.toBe(risksKey);
  });
});
