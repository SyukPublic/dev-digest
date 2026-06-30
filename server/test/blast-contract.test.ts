import { describe, expect, it } from 'vitest';
import { BlastResponse } from '../src/vendor/shared/contracts/review-api.js';

/**
 * Phase 1 (L04 Blast Radius) — contract unit test for the NEW `BlastResponse`
 * envelope. Pure Zod, no DB/IO. Asserts the additive response shape wrapping the
 * pre-existing `BlastRadius` plus the index `status` enum + optional reason.
 */
describe('BlastResponse contract', () => {
  const validBlast = { changed_symbols: [], downstream: [], summary: '' };

  it('accepts a valid envelope (empty map, status full, no reason)', () => {
    const res = BlastResponse.safeParse({
      pr_id: 'pr-1',
      blast: validBlast,
      status: 'full',
    });
    expect(res.success).toBe(true);
  });

  it('rejects a bad status value', () => {
    const res = BlastResponse.safeParse({
      pr_id: 'pr-1',
      blast: validBlast,
      status: 'foo',
    });
    expect(res.success).toBe(false);
  });

  it('treats degraded_reason as optional and accepts it when present', () => {
    const withReason = BlastResponse.safeParse({
      pr_id: 'pr-1',
      blast: validBlast,
      status: 'degraded',
      degraded_reason: 'index partially built',
    });
    expect(withReason.success).toBe(true);

    const withoutReason = BlastResponse.safeParse({
      pr_id: 'pr-1',
      blast: validBlast,
      status: 'partial',
    });
    expect(withoutReason.success).toBe(true);
  });

  it('accepts a populated map (reshaped DownstreamImpact)', () => {
    const res = BlastResponse.safeParse({
      pr_id: 'pr-1',
      blast: {
        changed_symbols: [{ name: 'doThing', file: 'src/a.ts', kind: 'function' }],
        downstream: [
          {
            symbol: 'doThing',
            callers: [{ name: 'caller', file: 'src/b.ts', line: 12 }],
            endpoints_affected: ['GET /things'],
            crons_affected: [],
          },
        ],
        summary: '1 changed symbol reaching 1 caller.',
      },
      status: 'full',
    });
    expect(res.success).toBe(true);
  });
});
