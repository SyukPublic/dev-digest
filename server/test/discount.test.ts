import { describe, it, expect } from 'vitest';
import { priceWithDiscount } from '../src/lib/discount.js';

// Happy-path only: covers SAVE10. The SAVE20 / HALF branches, the no-coupon
// default, and the negative-amount guard are intentionally left untested.
describe('priceWithDiscount', () => {
  it('applies a SAVE10 coupon', () => {
    expect(priceWithDiscount(1000, 'SAVE10')).toBe(900);
  });
});
