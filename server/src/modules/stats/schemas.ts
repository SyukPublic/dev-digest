import { z } from 'zod';
import { DAY_MS, DEFAULT_PERIOD_DAYS } from './constants.js';

/**
 * Shared period query for all three stats endpoints (edge validation, AC-3/AC-4).
 *
 *   ?days=1 | ?days=30            shorthand window (mutually exclusive with from/to)
 *   ?from=<iso>&to=<iso>          custom range (both-or-neither; from ≤ to)
 *   (absent)                      default to the last 30 days
 *
 * `resolvePeriod` is pure (takes `now` explicitly) so it unit-tests without a clock.
 */

/** An ISO date/datetime string that `Date` can parse (accepts date-only + datetime). */
const IsoDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'invalid ISO date' });

export const PeriodQuery = z
  .object({
    // Query params arrive as strings → coerce, then pin to the two allowed windows.
    days: z.coerce
      .number()
      .pipe(z.union([z.literal(1), z.literal(30)]))
      .optional(),
    from: IsoDate.optional(),
    to: IsoDate.optional(),
  })
  .refine((q) => (q.from == null) === (q.to == null), {
    message: 'from and to must be provided together',
    path: ['from'],
  })
  .refine((q) => !(q.days != null && (q.from != null || q.to != null)), {
    message: 'days is mutually exclusive with from/to',
    path: ['days'],
  })
  .refine((q) => q.from == null || q.to == null || Date.parse(q.from) <= Date.parse(q.to), {
    message: 'from must be on or before to',
    path: ['from'],
  });
export type PeriodQuery = z.infer<typeof PeriodQuery>;

export interface Period {
  from: Date;
  to: Date;
}

/**
 * Resolve a validated `PeriodQuery` to a concrete `{from,to}` window.
 * `now` is injected so the function is pure/deterministic in tests.
 */
export function resolvePeriod(query: PeriodQuery, now: Date): Period {
  if (query.from != null && query.to != null) {
    return { from: new Date(query.from), to: new Date(query.to) };
  }
  const days = query.days ?? DEFAULT_PERIOD_DAYS;
  const to = now;
  const from = new Date(now.getTime() - days * DAY_MS);
  return { from, to };
}

/**
 * The immediately-preceding window of equal length — the denominator for the
 * period-over-period delta chips (avg cost, total cost, accept-rate).
 */
export function previousPeriod(period: Period): Period {
  const span = period.to.getTime() - period.from.getTime();
  return { from: new Date(period.from.getTime() - span), to: period.from };
}
