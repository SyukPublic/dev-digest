/** Compute a discounted price (in integer cents) for an optional coupon code. */
export function priceWithDiscount(cents: number, coupon?: string): number {
  if (cents < 0) {
    throw new Error('amount must be non-negative');
  }
  let pct = 0;
  if (coupon === 'SAVE10') {
    pct = 10;
  } else if (coupon === 'SAVE20') {
    pct = 20;
  } else if (coupon === 'HALF') {
    pct = 50;
  }
  return Math.round(cents * (1 - pct / 100));
}
