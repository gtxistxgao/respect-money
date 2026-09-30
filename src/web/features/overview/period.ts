import type { CategorySpending, MonthSummary } from '../../../shared/models.js';

export function categoryMonthlySpending(months: MonthSummary[], category: string) {
  return months.map(month => {
    const item = month.categories.find(item => item.category === category);
    return { month: month.month, netExpenseCents: item ? item.expenseCents - item.refundCents : 0 };
  });
}

export function overviewPeriod(allMonths: MonthSummary[], period: string) {
  const yearMonths = allMonths.filter((month) => month.month.slice(0, 4) === period);
  const months = period === 'all' ? allMonths : yearMonths.length ? yearMonths : allMonths.slice(-12);
  const categories = new Map<string, CategorySpending>();
  for (const month of months) {
    for (const item of month.categories) {
      const total = categories.get(item.category) ?? { category: item.category, expenseCents: 0, refundCents: 0 };
      total.expenseCents += item.expenseCents;
      total.refundCents += item.refundCents;
      categories.set(item.category, total);
    }
  }
  return {
    months,
    categories: [...categories.values()],
    incomeCents: months.reduce((total, month) => total + month.incomeCents, 0),
    expenseCents: months.reduce((total, month) => total + month.expenseCents, 0),
  };
}
