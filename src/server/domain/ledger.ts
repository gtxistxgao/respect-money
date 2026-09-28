import { message as t, LocalizedError } from "../../i18n/index.js";
import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { categorySchema, confirmedCategoryKind, dateSchema, kindSchema, type Account, type Classification, type DateRange, type LedgerRow, type RawRecord, type SourceTransaction, type Summary, type TransactionOverride } from '../../shared/models.js';

export class AppError extends LocalizedError {
  constructor(message: string, public statusCode = 400) { super(message); }
}
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function cents(amount: string | number) {
  const value = new Decimal(amount).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  if (!Number.isSafeInteger(value)) throw new AppError(t("The amount exceeds the supported range."));
  return value;
}
export function transactionId(record: RawRecord) {
  const p = record.payload;
  const sourceId = String(p.id || p.transaction_id || p.investment_transaction_id || '');
  if (!sourceId) throw new AppError(t("The source transaction is missing an ID."));
  return record.source === 'manual' ? sourceId : `tx_${hash([record.accountId, record.source, sourceId]).slice(0, 28)}`;
}
const text = (value: unknown) => typeof value === 'string' ? value : '';

export function normalize(record: RawRecord): SourceTransaction {
  const p = record.payload;
  const id = transactionId(record);
  const manual = record.source === 'manual';
  const cashflowCents = manual ? Number(p.cashflowCents) : -cents(Number(p.amount));
  if (!Number.isSafeInteger(cashflowCents)) throw new AppError(t("Invalid transaction amount."));
  const postedDate = text(manual ? p.postedDate : p.date);
  if (!dateSchema.safeParse(postedDate).success) throw new AppError(t("Invalid source transaction date."));
  const pfc = (p.personal_finance_category || {}) as { primary?: string; detailed?: string };
  const location = (p.location || {}) as { country?: string };
  const description = text(manual ? p.description : p.name);
  const lower = description.toLowerCase();
  let kind: SourceTransaction['kind'] = cashflowCents < 0 ? 'expense' : 'review';
  let category: SourceTransaction['category'] = 'uncategorized';
  let pending = Boolean(p.pending);
  let removed = Boolean(p._removed);
  if (manual) {
    kind = kindSchema.parse(p.kind);
    category = categorySchema.parse(p.category);
  } else if (record.source === 'plaid_investments') {
    const type = text(p.type);
    const subtype = text(p.subtype);
    pending = ['pending credit', 'pending debit', 'request', 'interest receivable'].includes(subtype);
    removed ||= type === 'cancel';
    kind = 'review';
    if (subtype.includes('reinvestment')) kind = 'reinvestment';
    else if (['buy', 'sell'].includes(type)) kind = 'investment';
    else if (type === 'transfer' || ['contribution', 'deposit', 'withdrawal', 'transfer', 'return of principal'].includes(subtype)) kind = 'transfer';
    else if (type === 'fee') { kind = 'expense'; category = 'investments'; }
    else if (subtype === 'interest' && cashflowCents >= 0) { kind = 'income'; category = 'interest'; }
    else if (['dividend', 'qualified dividend', 'non-qualified dividend'].includes(subtype) && cashflowCents >= 0) { kind = 'income'; category = 'dividends'; }
  } else {
    const primary = pfc.primary || '';
    const detail = pfc.detailed || '';
    if (detail.includes('CREDIT_CARD_PAYMENT') || /credit card (auto)?pay|autopay payment|\bpayment(?:\s+|\s*[-–—]\s*)thank(?:\s+you)?\b/.test(lower)) kind = 'payment';
    else if (primary.startsWith('TRANSFER') || /\bzelle\b|\bvenmo\b|reimburse/.test(lower)) kind = 'review';
    else if (cashflowCents > 0 && /refund|return of purchase/.test(lower)) kind = 'refund';
    else if (primary === 'INCOME' && !/refund|transfer/.test(lower)) {
      kind = 'income';
      if (/wage|salary|payroll/i.test(`${detail} ${lower}`)) category = 'salary';
      else if (/interest/i.test(`${detail} ${lower}`)) category = 'interest';
      else if (/dividend/i.test(`${detail} ${lower}`)) category = 'dividends';
    }
    const mapped: Record<string, SourceTransaction['category']> = {
      FOOD_AND_DRINK: 'dining', TRANSPORTATION: 'transport', TRAVEL: 'travel', MEDICAL: 'health',
      ENTERTAINMENT: 'entertainment', RENT_AND_UTILITIES: 'housing', GENERAL_MERCHANDISE: 'shopping',
    };
    if (category === 'uncategorized') category = detail.includes('GROCERIES') ? 'groceries' : mapped[primary] || category;
  }
  const country = text(manual ? p.country : location.country).toUpperCase();
  return {
    id, accountId: record.accountId, source: record.source,
    sourceId: String(p.id || p.transaction_id || p.investment_transaction_id),
    postedDate, description, merchant: text(p.merchant_name) || description,
    cashflowCents, currency: manual ? 'USD' : text(p.iso_currency_code), pending, removed,
    sourceHash: hash(p), kind, category, country: /^[A-Z]{2}$/.test(country) ? country : 'US',
    countrySource: manual ? 'manual' : /^[A-Z]{2}$/.test(country) ? 'bank' : 'default', notes: text(p.notes), raw: p,
  };
}

export function mergeRanges(ranges: DateRange[]) {
  const merged: DateRange[] = [];
  for (const range of [...ranges].sort((a, b) => a.start.localeCompare(b.start))) {
    const last = merged.at(-1);
    if (last && Date.parse(range.start) <= Date.parse(last.end) + 86400000) last.end = range.end > last.end ? range.end : last.end;
    else merged.push({ ...range });
  }
  return merged;
}
export const inRanges = (date: string, ranges: DateRange[]) => ranges.some((range) => date >= range.start && date <= range.end);

export function createLedger(
  records: RawRecord[], accounts: Account[], overrides: Record<string, TransactionOverride>,
  classifications: Record<string, Classification>, ranges: Record<string, DateRange[]>,
): LedgerRow[] {
  const all = records.map(normalize);
  const sources = new Map(all.map((tx) => [tx.id, tx]));
  const accountTransfers = all.filter((tx) => tx.source === 'plaid_transactions' && !tx.pending && !tx.removed && tx.kind === 'review'
    && /TRANSFER_(IN|OUT)_ACCOUNT_TRANSFER/.test(text((tx.raw.personal_finance_category as { detailed?: string })?.detailed))
    && !/zelle|venmo|paypal|reimburse/i.test(tx.description));
  const ownTransfers = new Set<string>();
  for (const tx of accountTransfers) {
    const matches = accountTransfers.filter((other) => other.accountId !== tx.accountId && other.postedDate === tx.postedDate && other.currency === tx.currency && other.cashflowCents === -tx.cashflowCents);
    if (matches.length === 1 && accountTransfers.filter((other) => other.accountId !== matches[0].accountId && other.postedDate === tx.postedDate && other.currency === tx.currency && other.cashflowCents === tx.cashflowCents).length === 1) ownTransfers.add(tx.id);
  }
  const reinvestments = all.filter((t) => t.kind === 'reinvestment' && !t.removed && !t.pending);
  const distributions = all.filter((t) => ['dividends', 'interest'].includes(t.category) && t.kind === 'income' && t.source === 'plaid_investments' && !t.removed && !t.pending);
  const reinvestmentDecision = new Map<string, 'reinvestment' | 'review'>();
  const matchesReinvestment = (a: SourceTransaction, b: SourceTransaction) => a.accountId === b.accountId && a.currency === b.currency
    && a.postedDate === b.postedDate && a.raw.security_id && a.raw.security_id === b.raw.security_id && Math.abs(a.cashflowCents) === Math.abs(b.cashflowCents);
  for (const distribution of distributions) {
    const exact = reinvestments.filter((r) => matchesReinvestment(distribution, r));
    if (exact.length === 1 && distributions.filter((d) => matchesReinvestment(d, exact[0])).length === 1) reinvestmentDecision.set(distribution.id, 'reinvestment');
    else if (reinvestments.some((r) => r.accountId === distribution.accountId && r.currency === distribution.currency
      && Math.abs(Date.parse(r.postedDate) - Date.parse(distribution.postedDate)) <= 3 * 86400000
      && (!r.raw.security_id || !distribution.raw.security_id || r.raw.security_id === distribution.raw.security_id))) reinvestmentDecision.set(distribution.id, 'review');
  }
  const rows: LedgerRow[] = [];
  for (const tx of all) {
    const account = accounts.find((a) => a.id === tx.accountId);
    if (!account) throw new AppError(t("The account associated with this transaction does not exist."), 500);
    if (tx.removed || tx.pending || (tx.source !== 'manual' && !inRanges(tx.postedDate, ranges[tx.accountId] || []))) continue;
    const override = overrides[tx.id];
    const saved = classifications[tx.id];
    const classification = saved?.sourceHash === tx.sourceHash ? saved : undefined;
    const category = override?.category ?? (tx.source === 'manual' && tx.category !== 'uncategorized' ? tx.category : classification?.category ?? tx.category);
    const categoryConfirmed = Boolean(override?.category && override.category !== 'uncategorized' && override.kind !== 'review');
    let kind = override?.kind ?? (tx.source === 'manual' ? tx.kind : classification?.kind ?? tx.kind);
    if (categoryConfirmed && kind === 'review') kind = confirmedCategoryKind(tx.kind, category, tx.cashflowCents);
    if (!override?.kind && ownTransfers.has(tx.id)) kind = 'transfer';
    if (!override?.kind && reinvestmentDecision.has(tx.id)) kind = reinvestmentDecision.get(tx.id)!;
    // Derive the transfer kind without overwriting the original income/expense/refund direction.
    if (category === 'internal_transfer' && kind !== 'excluded') kind = 'transfer';
    const signMismatch = (kind === 'income' && tx.cashflowCents < 0) || (kind === 'expense' && tx.cashflowCents > 0) || (kind === 'refund' && tx.cashflowCents < 0);
    const invalidSplits = Boolean(override?.splits?.length && override.splits.reduce((sum, split) => sum + split.cashflowCents, 0) !== tx.cashflowCents);
    const counterpart = override?.duplicateOf ? sources.get(override.duplicateOf) : undefined;
    const brokenMatch = Boolean(override?.duplicateOf && (!counterpart || counterpart.pending || counterpart.removed || counterpart.cashflowCents !== tx.cashflowCents));
    if (signMismatch || invalidSplits || brokenMatch) kind = 'review';
    const excluded = Boolean(override?.excluded || (override?.duplicateOf && !brokenMatch) || kind === 'excluded');
    const row: LedgerRow = {
      ...tx, raw: undefined,
      kind: excluded ? 'excluded' : kind,
      category,
      country: override?.country ?? (tx.countrySource !== 'default' ? tx.country : classification?.country ?? tx.country),
      countrySource: override?.country ? 'manual' : tx.countrySource !== 'default' ? tx.countrySource : classification?.countrySource ?? 'default',
      accountName: account.name, accountMask: account.mask, institution: account.institution,
      version: `${tx.sourceHash}:${override?.revision || 0}`, parentId: tx.id,
      splitCount: override?.splits?.length || 0,
      needsReview: kind === 'review' || (category !== 'internal_transfer' && !categoryConfirmed && override?.kind === undefined && !ownTransfers.has(tx.id) && Boolean(classification?.needsReview)),
      reason: brokenMatch ? t("The linked bank transaction was removed or changed. Review the manual entry.") : invalidSplits ? t("The source amount changed. Review the split amounts.") : reinvestmentDecision.get(tx.id) === 'review' ? t("This may be an automatic reinvestment. Confirm whether cash was actually received.") : classification?.reason || '',
      classificationSource: tx.source === 'manual' && tx.category !== 'uncategorized' || override && (override.kind || override.category || override.country) ? 'manual' : classification ? classification.provider ?? 'codex' : 'rules',
      notes: override?.notes ?? tx.notes, excluded, duplicateOf: override?.duplicateOf,
      classifiedAt: override?.updatedAt || classification?.classifiedAt, classifierVersion: classification?.classifierVersion,
    } as LedgerRow;
    if (override?.splits?.length && !invalidSplits && !excluded && !brokenMatch && !signMismatch) {
      for (const split of override.splits) rows.push({ ...row, ...split, id: `${tx.id}:${split.id}`, parentId: tx.id, splitId: split.id,
        description: split.description || row.description, kind: split.category === 'internal_transfer' && split.kind !== 'excluded' ? 'transfer' : split.kind, countrySource: 'manual',
        classificationSource: 'manual', excluded: split.kind === 'excluded', needsReview: false });
    } else rows.push(row);
  }
  return rows.sort((a, b) => b.postedDate.localeCompare(a.postedDate) || a.id.localeCompare(b.id));
}

export function summarize(rows: LedgerRow[]): Summary {
  const result: Summary = { incomeCents: 0, expenseCents: 0, netCents: 0, reviewCents: 0, reviewCount: 0, transactionCount: rows.length };
  for (const row of rows) {
    if (row.excluded || row.currency !== 'USD') continue;
    if (row.kind === 'review' || row.needsReview) { result.reviewCents += Math.abs(row.cashflowCents); result.reviewCount++; }
    else if (row.kind === 'income') result.incomeCents += row.cashflowCents;
    else if (row.kind === 'expense' || row.kind === 'refund') result.expenseCents -= row.cashflowCents;
  }
  result.netCents = result.incomeCents - result.expenseCents;
  for (const value of Object.values(result)) if (!Number.isSafeInteger(value)) throw new AppError(t("The total exceeds the supported range."));
  return result;
}
