import { describe, it, expect } from 'vitest';
import { priceWithDiscount } from '../src/lib/discount.js';

describe('priceWithDiscount', () => {
  it('applies a SAVE10 coupon', () => {
    expect(priceWithDiscount(1000, 'SAVE10')).toBe(900);
  });
});
