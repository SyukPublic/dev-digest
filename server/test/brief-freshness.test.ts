/**
 * Phase 4 (T13) — `briefFreshnessKey` unit tests (CP-6, AC-14).
 *
 * Pure hash — no DB/IO. Proves the key is stable over the ORDERED parts
 * [headSha, base, title, body, provider, model, promptVersion, intentKey],
 * changes when ANY part changes, EXCLUDES the issue/specs (they are not inputs),
 * and that the write key equals the read key for the same inputs. The NULL
 * stored-key ⇒ not-stale rule is exercised via `isStale` in brief-service.test.
 */

import { describe, it, expect } from 'vitest';
import { briefFreshnessKey } from '../src/modules/brief/freshness.js';

const BASE = {
  headSha: 'sha-1',
  base: 'main',
  title: 'Add the widget',
  body: 'closes #12',
  provider: 'openrouter',
  model: 'gpt-x',
  promptVersion: 1,
  intentKey: 'intent-key-1',
};

describe('briefFreshnessKey', () => {
  it('is deterministic: same inputs → same key (write == read)', () => {
    expect(briefFreshnessKey(BASE)).toBe(briefFreshnessKey({ ...BASE }));
  });

  it('changes when ANY output-determining part changes', () => {
    const base = briefFreshnessKey(BASE);
    const perturbations: Partial<typeof BASE>[] = [
      { headSha: 'sha-2' },
      { base: 'develop' },
      { title: 'Add the gadget' },
      { body: 'closes #13' },
      { provider: 'anthropic' },
      { model: 'claude-x' },
      { promptVersion: 2 },
      { intentKey: 'intent-key-2' },
    ];
    for (const patch of perturbations) {
      expect(briefFreshnessKey({ ...BASE, ...patch })).not.toBe(base);
    }
  });

  it('folds in the anchored intent key (brief goes stale when intent is recomputed)', () => {
    const withIntent = briefFreshnessKey({ ...BASE, intentKey: 'k1' });
    const withOtherIntent = briefFreshnessKey({ ...BASE, intentKey: 'k2' });
    const withNoIntent = briefFreshnessKey({ ...BASE, intentKey: '' });
    expect(withIntent).not.toBe(withOtherIntent);
    expect(withIntent).not.toBe(withNoIntent);
  });

  it('is ORDER-sensitive: swapping title↔body changes the key', () => {
    // If parts were concatenated order-blind, swapping two would collide.
    const swapped = briefFreshnessKey({ ...BASE, title: BASE.body, body: BASE.title });
    expect(swapped).not.toBe(briefFreshnessKey(BASE));
  });
});
