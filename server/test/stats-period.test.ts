/**
 * Stats period query + resolvePeriod (`modules/stats/schemas.ts`) — the edge
 * validation for the three stats endpoints (AC-3, AC-4). Pure: `resolvePeriod`
 * takes `now` explicitly.
 */
import { describe, it, expect } from 'vitest';
import { PeriodQuery, resolvePeriod, previousPeriod } from '../src/modules/stats/schemas.js';

const NOW = new Date('2026-07-17T00:00:00.000Z');
const DAY = 86_400_000;

describe('PeriodQuery validation (AC-4)', () => {
  it('accepts ?days=1 and ?days=30 (coerced from strings)', () => {
    expect(PeriodQuery.parse({ days: '1' }).days).toBe(1);
    expect(PeriodQuery.parse({ days: '30' }).days).toBe(30);
  });

  it('rejects a days value that is not 1 or 30', () => {
    expect(PeriodQuery.safeParse({ days: '7' }).success).toBe(false);
  });

  it('accepts a valid custom range', () => {
    expect(
      PeriodQuery.safeParse({ from: '2026-07-01T00:00:00Z', to: '2026-07-10T00:00:00Z' }).success,
    ).toBe(true);
  });

  it('rejects from > to', () => {
    expect(
      PeriodQuery.safeParse({ from: '2026-07-10T00:00:00Z', to: '2026-07-01T00:00:00Z' }).success,
    ).toBe(false);
  });

  it('rejects a malformed ISO bound', () => {
    expect(PeriodQuery.safeParse({ from: 'not-a-date', to: '2026-07-10T00:00:00Z' }).success).toBe(
      false,
    );
  });

  it('rejects from without to (both-or-neither)', () => {
    expect(PeriodQuery.safeParse({ from: '2026-07-01T00:00:00Z' }).success).toBe(false);
  });

  it('rejects days combined with a custom range (mutually exclusive)', () => {
    expect(
      PeriodQuery.safeParse({ days: '30', from: '2026-07-01T00:00:00Z', to: '2026-07-10T00:00:00Z' })
        .success,
    ).toBe(false);
  });

  it('accepts an empty query (defaults applied by resolvePeriod)', () => {
    expect(PeriodQuery.safeParse({}).success).toBe(true);
  });
});

describe('resolvePeriod (AC-3)', () => {
  it('defaults to the last 30 days when no param is present', () => {
    const p = resolvePeriod({}, NOW);
    expect(p.to).toEqual(NOW);
    expect(p.from).toEqual(new Date(NOW.getTime() - 30 * DAY));
  });

  it('honors ?days=1', () => {
    const p = resolvePeriod({ days: 1 }, NOW);
    expect(p.from).toEqual(new Date(NOW.getTime() - DAY));
  });

  it('uses the explicit custom range verbatim', () => {
    const p = resolvePeriod({ from: '2026-07-01T00:00:00Z', to: '2026-07-10T00:00:00Z' }, NOW);
    expect(p.from).toEqual(new Date('2026-07-01T00:00:00Z'));
    expect(p.to).toEqual(new Date('2026-07-10T00:00:00Z'));
  });
});

describe('previousPeriod', () => {
  it('is the equal-length window immediately before the current one', () => {
    const cur = resolvePeriod({ days: 30 }, NOW);
    const prev = previousPeriod(cur);
    expect(prev.to).toEqual(cur.from);
    expect(prev.from).toEqual(new Date(cur.from.getTime() - 30 * DAY));
  });
});
