import type { MonthSummary } from '../../../shared/models.js';

export function overviewPeriod(allMonths: MonthSummary[], period: string) {
  const yearMonths = allMonths.filter((month) => month.month.slice(0, 4) === period);
  const months = period === 'all' ? allMonths : yearMonths.length ? yearMonths : allMonths.slice(-12);
  return {
    months,
    incomeCents: months.reduce((total, month) => total + month.incomeCents, 0),
    expenseCents: months.reduce((total, month) => total + month.expenseCents, 0),
  };
}
