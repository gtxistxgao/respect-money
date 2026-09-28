import { resolveCategories, resolveCategoryId, type CategoryConfiguration } from '../../shared/categories.js';
import { financialKind, type LedgerRow } from '../../shared/models.js';

// Project published legacy activities into independent category / cashflow fields.
// This never changes the source amount or publishes unfinished AI work.
export function applyCategoryPolicy(row: LedgerRow, settings?: CategoryConfiguration): LedgerRow {
  const category = resolveCategoryId(activityCategory(row.kind, row.category), settings);
  return { ...row, category, kind: financialKind(row.kind, row.cashflowCents),
    excluded: row.excluded || row.kind === 'excluded',
    categoryExcluded: !resolveCategories(settings).find(item => item.id === category)!.includeInCashflow };
}

export function activityCategory(kind: LedgerRow['kind'], category: string) {
  if (kind === 'reinvestment' || kind === 'investment') return 'investment_transaction';
  if (kind === 'transfer') return 'internal_transfer';
  if (kind === 'payment') return 'credit_card_payment';
  return category;
}
