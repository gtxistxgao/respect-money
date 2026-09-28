import { message as t } from "../../i18n/index.js";
import { today, type Account, type CategorySpending, type LedgerRow, type MonthSummary, type OverviewData } from '../../shared/models.js';
import type { RepositoryState } from '../storage/repository.js';
import { AppError, summarize } from './ledger.js';

function selectedAccounts(state: RepositoryState, ids?: string) {
  const selected = ids ? new Set(ids.split(',')) : undefined;
  return state.accounts.filter((account) => account.enabled && (!selected || selected.has(account.id)));
}

function summarizeMonth(state: RepositoryState, accounts: Account[], rows: LedgerRow[], month: string, reference: string): MonthSummary {
  const summary = summarize(rows);
  const buckets = new Map<string, CategorySpending>();
  let grossExpenseCents = 0;
  let refundCents = 0;
  for (const row of rows) {
    if (row.excluded || row.categoryExcluded || row.needsReview || row.currency !== 'USD' || !['expense', 'refund'].includes(row.kind)) continue;
    const bucket = buckets.get(row.category) || { category: row.category, expenseCents: 0, refundCents: 0 };
    if (row.kind === 'expense') { bucket.expenseCents -= row.cashflowCents; grossExpenseCents -= row.cashflowCents; }
    else { bucket.refundCents += row.cashflowCents; refundCents += row.cashflowCents; }
    if (![grossExpenseCents, refundCents, bucket.expenseCents, bucket.refundCents].every(Number.isSafeInteger)) throw new AppError(t("The category total exceeds the supported range."));
    buckets.set(row.category, bucket);
  }
  const monthEnd = `${month}-${new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate()}`;
  const expectedEnd = monthEnd > reference ? reference : monthEnd;
  const incompleteAccounts = accounts.filter((account) => account.source === 'plaid'
    && !(state.ranges[account.id] || []).some((range) => range.start <= `${month}-01` && range.end >= expectedEnd))
    .map((account) => `${account.name}${account.mask ? ` · ${account.mask}` : ''}`);
  return {
    ...summary, month, grossExpenseCents, refundCents,
    categories: [...buckets.values()].sort((a, b) => b.expenseCents - a.expenseCents || a.category.localeCompare(b.category)),
    spendingIncomeRatio: summary.incomeCents > 0 ? summary.expenseCents / summary.incomeCents : null,
    stale: accounts.some((account) => state.staleAccountIds.includes(account.id)), incompleteAccounts,
  };
}

export function monthSummary(state: RepositoryState, month: string, ids?: string, reference = today()): MonthSummary {
  const accounts = selectedAccounts(state, ids);
  const allowed = new Set(accounts.map((account) => account.id));
  return summarizeMonth(state, accounts, state.processed.filter((row) => allowed.has(row.accountId) && row.postedDate.startsWith(month)), month, reference);
}

export function overview(state: RepositoryState, ids?: string, reference = today()): OverviewData {
  const accounts = selectedAccounts(state, ids);
  const allowed = new Set(accounts.map((account) => account.id));
  const grouped = new Map<string, LedgerRow[]>();
  for (const row of state.processed) {
    if (!allowed.has(row.accountId)) continue;
    const month = row.postedDate.slice(0, 7);
    if (!grouped.has(month)) grouped.set(month, []);
    grouped.get(month)!.push(row);
  }
  const recordedMonths = [...grouped.keys()].sort();
  if (!recordedMonths.length) return { months: [] };
  // Keep gaps in the time axis; the UI labels them as missing records, not zero spending.
  const months: MonthSummary[] = [];
  let cursor = recordedMonths[0];
  const last = recordedMonths.at(-1)!;
  while (cursor <= last) {
    months.push(summarizeMonth(state, accounts, grouped.get(cursor) || [], cursor, reference));
    if (cursor === last) break;
    const [year, month] = cursor.split('-').map(Number);
    cursor = month === 12 ? `${String(year + 1).padStart(4, '0')}-01` : `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}`;
  }
  return { months };
}
