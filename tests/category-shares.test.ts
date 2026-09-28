import { describe, expect, it } from 'vitest';
import { netCategoryShares } from '../src/web/features/overview/category-shares.js';

describe('category shares after refunds', () => {
  it('deducts refunds from both the category amount and share denominator', () => {
    const rows = netCategoryShares([
      { category: 'travel', expenseCents: 100000, refundCents: 25000 },
      { category: 'dining', expenseCents: 25000, refundCents: 0 },
    ]);
    expect(rows).toMatchObject([
      { category: 'travel', netExpenseCents: 75000, share: .75 },
      { category: 'dining', netExpenseCents: 25000, share: .25 },
    ]);
    expect(rows.reduce((sum, row) => sum + row.netExpenseCents, 0)).toBe(100000);
  });
  it('keeps full and excess refunds visible without negative or inflated bars', () => {
    const rows = netCategoryShares([
      { category: 'travel', expenseCents: 0, refundCents: 5000 },
      { category: 'shopping', expenseCents: 2000, refundCents: 2000 },
      { category: 'dining', expenseCents: 3000, refundCents: 0 },
    ]);
    expect(rows).toMatchObject([
      { category: 'dining', netExpenseCents: 3000, share: 1 },
      { category: 'shopping', netExpenseCents: 0, share: 0 },
      { category: 'travel', netExpenseCents: -5000, share: 0 },
    ]);
  });
  it('handles months containing only refunds and empty categories', () => {
    expect(netCategoryShares([{ category: 'travel', expenseCents: 0, refundCents: 5000 }])).toMatchObject([{ netExpenseCents: -5000, share: 0 }]);
    expect(netCategoryShares([{ category: 'travel', expenseCents: 0, refundCents: 0 }])).toEqual([]);
    expect(netCategoryShares([])).toEqual([]);
  });
});
