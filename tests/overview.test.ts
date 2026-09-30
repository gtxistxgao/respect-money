import { describe, expect, it } from 'vitest';
import type { Account, LedgerRow } from '../src/shared/models.js';
import type { RepositoryState } from '../src/server/storage/repository.js';
import { createLedger, summarize } from '../src/server/domain/ledger.js';
import { monthSummary, overview } from '../src/server/domain/overview.js';
import { overviewPeriod } from '../src/web/features/overview/period.js';

const account: Account = { id: 'card', name: 'Fictional card', institution: 'Test', mask: '1234', type: 'credit', source: 'manual', enabled: true, createdAt: '2025-01-01' };
const baseRow = createLedger([{ accountId: account.id, source: 'manual', payload: { id: 'purchase', postedDate: '2026-02-03', description: 'Fictional purchase', cashflowCents: -10000, kind: 'expense', category: 'dining', country: 'US' } }], [account], {}, {}, {})[0];
const row = (value: Partial<LedgerRow> = {}): LedgerRow => ({ ...baseRow, ...value });
function state(rows: LedgerRow[], accounts = [account]): RepositoryState {
  return { schemaVersion: 1, revision: 0, accounts, connections: {}, ranges: {}, jobs: {}, staleAccountIds: [], records: {}, overrides: {}, classifications: {}, processed: rows, vault: { userId: 'fixture', tokens: {}, links: {} } };
}

describe('monthly overview', () => {
  it('matches the ledger totals and keeps split categories, refunds, and excluded records distinct', () => {
    const rows = [
      row({ id: 'split-a', parentId: 'purchase', splitId: 'a', cashflowCents: -7000 }),
      row({ id: 'split-b', parentId: 'purchase', splitId: 'b', category: 'shopping', cashflowCents: -3000 }),
      row({ kind: 'refund', cashflowCents: 2000 }), row({ kind: 'income', category: 'salary', cashflowCents: 20000 }),
      row({ kind: 'payment' }), row({ kind: 'transfer' }), row({ kind: 'investment' }), row({ kind: 'reinvestment' }),
      row({ needsReview: true }), row({ excluded: true, duplicateOf: 'bank-record' }), row({ currency: 'EUR' }),
    ];
    const result = overview(state(rows)).months[0];
    expect(result).toMatchObject({ ...summarize(rows), month: '2026-02', expenseCents: 8000, incomeCents: 20000, netCents: 12000, grossExpenseCents: 10000, refundCents: 2000, spendingIncomeRatio: .4, reviewCount: 1 });
    expect(result.categories).toEqual([{ category: 'dining', expenseCents: 7000, refundCents: 2000 }, { category: 'shopping', expenseCents: 3000, refundCents: 0 }]);
    expect(monthSummary(state(rows), '2026-02')).toEqual(result);
  });
  it('keeps calendar gaps across years and filters disabled and unselected accounts', () => {
    const second = { ...account, id: 'second' };
    const disabled = { ...account, id: 'disabled', enabled: false };
    const value = state([row({ postedDate: '2025-12-03' }), row(), row({ accountId: 'second', postedDate: '2025-11-01' }), row({ accountId: 'disabled', postedDate: '2024-01-01' })], [account, second, disabled]);
    const result = overview(value, 'card').months;
    expect(result.map((month) => month.month)).toEqual(['2025-12', '2026-01', '2026-02']);
    expect(result[1]).toMatchObject({ transactionCount: 0, spendingIncomeRatio: null, categories: [] });
    expect(overview(value).months[0].month).toBe('2025-11');
    expect(overview(value, 'disabled,missing').months).toEqual([]);
  });
  it('preserves negative net spending and undefined ratios for zero income', () => {
    const refundsOnly = state([row({ kind: 'refund', cashflowCents: 3000 })]);
    expect(overview(refundsOnly).months[0]).toMatchObject({ expenseCents: -3000, grossExpenseCents: 0, refundCents: 3000, spendingIncomeRatio: null });
    const overIncome = state([row(), row({ kind: 'income', cashflowCents: 5000 })]);
    expect(overview(overIncome).months[0].spendingIncomeRatio).toBe(2);
    expect(overview(state([])).months).toEqual([]);
  });
  it('carries incomplete coverage and stale classifications into each month', () => {
    const bank = { ...account, source: 'plaid' as const };
    const value = state([row()], [bank]);
    value.staleAccountIds = ['card'];
    value.ranges.card = [{ start: '2026-02-01', end: '2026-02-15' }];
    expect(overview(value, undefined, '2026-02-16').months[0]).toMatchObject({ stale: true, incompleteAccounts: ['Fictional card · 1234'] });
    expect(overview(value, undefined, '2026-02-15').months[0].incompleteAccounts).toEqual([]);
  });
  it('rejects gross totals that exceed safe integer precision even when refunds cancel them', () => {
    const value = state([row({ cashflowCents: -Number.MAX_SAFE_INTEGER }), row({ kind: 'refund', cashflowCents: Number.MAX_SAFE_INTEGER }), row({ cashflowCents: -100 })]);
    expect(() => overview(value)).toThrow("The category total exceeds the supported range");
  });
  it('totals the displayed twelve months, selected year, or full history with refunds deducted once', () => {
    const rows = ['2024-12', '2025-01', '2025-12', '2026-01'].flatMap((month, index) => [
      row({ postedDate: `${month}-01`, kind: 'income', cashflowCents: (index + 1) * 100000 }),
      row({ postedDate: `${month}-02`, cashflowCents: -(index + 1) * 10000 }),
    ]);
    rows.push(row({ postedDate: '2025-12-03', kind: 'refund', cashflowCents: 5000 }), row({ postedDate: '2026-01-03', kind: 'refund', cashflowCents: 2500 }));
    const months = overview(state(rows)).months;
    const recent = overviewPeriod(months, '12');
    expect(recent.months).toHaveLength(12);
    expect(recent.months[0].month).toBe('2025-02');
    expect(recent).toMatchObject({ incomeCents: 700000, expenseCents: 62500 });
    expect(overviewPeriod(months, '2025')).toMatchObject({ incomeCents: 500000, expenseCents: 45000 });
    expect(overviewPeriod(months, '2024')).toMatchObject({ incomeCents: 100000, expenseCents: 10000 });
    expect(overviewPeriod(months, 'all')).toMatchObject({ incomeCents: 1000000, expenseCents: 92500 });
    expect(overviewPeriod(months, 'unknown')).toEqual(recent);
  });
  it('keeps period totals scoped to included accounts and categories and preserves net refunds', () => {
    const value = state([
      row({ kind: 'refund', cashflowCents: 5000 }),
      row({ kind: 'income', cashflowCents: 10000 }),
      row({ excluded: true }), row({ categoryExcluded: true }), row({ needsReview: true }), row({ currency: 'CAD' }),
      row({ accountId: 'second', kind: 'income', cashflowCents: 25000 }),
      row({ accountId: 'disabled', kind: 'income', cashflowCents: 50000 }),
    ], [account, { ...account, id: 'second' }, { ...account, id: 'disabled', enabled: false }]);
    expect(overviewPeriod(overview(value).months, 'all')).toMatchObject({ incomeCents: 35000, expenseCents: -5000 });
    expect(overviewPeriod(overview(value, 'card').months, '12')).toMatchObject({ incomeCents: 10000, expenseCents: -5000 });
    expect(overviewPeriod(overview(value, 'disabled').months, 'all')).toEqual({ months: [], incomeCents: 0, expenseCents: 0 });
  });
});
