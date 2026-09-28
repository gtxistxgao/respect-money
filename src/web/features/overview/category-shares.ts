import type { CategorySpending } from '../../../shared/models.js';

export function netCategoryShares(categories: CategorySpending[]) {
  const rows = categories.filter(row => row.expenseCents > 0 || row.refundCents > 0)
    .map(row => ({ ...row, netExpenseCents: row.expenseCents - row.refundCents }));
  // Net refunds remain visible, but cannot produce negative shares or inflate
  // another category above 100%. Only positive net spending fills the bars.
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.netExpenseCents), 0);
  return rows.map(row => ({ ...row, share: total > 0 ? Math.max(0, row.netExpenseCents) / total : 0 }))
    .sort((a, b) => b.netExpenseCents - a.netExpenseCents || a.category.localeCompare(b.category));
}
