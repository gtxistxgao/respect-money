import { message as t, translate, getLocale } from "../i18n/index.js";
import { z } from 'zod';

import { categoryOptions, canonicalCategory, categoryIdSchema } from './categories.js';
export { categoryOptions, canonicalCategory } from './categories.js';
export const categories = categoryOptions.map(([id]) => id);
export const categorySchema = z.preprocess(canonicalCategory, categoryIdSchema);
export type Category = z.infer<typeof categorySchema>;
export const countryOptions = [['US', "United States"], ['CN', "China"], ['JP', "Japan"], ['CA', "Canada"], ['GB', "United Kingdom"], ['KR', "South Korea"], ['FR', "France"], ['DE', "Germany"], ['SG', "Singapore"], ['AU', "Australia"]] as const;
export const countrySchema = z.string().regex(/^[A-Z]{2}$/);
export const kindSchema = z.enum(['income', 'expense', 'refund', 'transfer', 'payment', 'investment', 'reinvestment', 'excluded', 'review']);
export type TransactionKind = z.infer<typeof kindSchema>;
export function financialKind(kind: TransactionKind, cashflowCents: number): 'income' | 'expense' | 'refund' | 'review' {
  return ['income', 'expense', 'refund', 'review'].includes(kind) ? kind as 'income' | 'expense' | 'refund' | 'review' : cashflowCents > 0 ? 'income' : 'expense';
}
export const kindLabels: Record<TransactionKind, string> = {
  income: "Income", expense: "Spending", refund: "Refund", transfer: "Internal transfer", payment: "Credit card payment",
  investment: "Investment transaction", reinvestment: "Automatic reinvestment", excluded: "Excluded", review: "Needs review",
};
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, t("Invalid date"));
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const rangeSchema = z.object({ start: dateSchema, end: dateSchema }).refine((r) => r.start <= r.end, t("The start date cannot be after the end date"));
export type DateRange = z.infer<typeof rangeSchema>;
export const accountSchema = z.object({
  id: z.string(), name: z.string().min(1).max(100), institution: z.string().min(1).max(100),
  mask: z.string().max(10), type: z.enum(['checking', 'savings', 'credit', 'investment', 'cash', 'other']),
  source: z.enum(['manual', 'plaid']), enabled: z.boolean(),
  itemId: z.string().optional(), plaidAccountId: z.string().optional(),
  disconnectedAt: z.string().optional(),
  createdAt: z.string(),
});
export type Account = z.infer<typeof accountSchema>;
export const manualAccountInput = accountSchema.pick({ name: true, institution: true, type: true }).extend({ mask: z.string().max(10).default('') });
export const sourceSchema = z.enum(['manual', 'plaid_transactions', 'plaid_investments']);
export type TransactionSource = z.infer<typeof sourceSchema>;
export type RawRecord = { accountId: string; source: TransactionSource; payload: Record<string, unknown> };

export type SourceTransaction = {
  id: string; accountId: string; source: TransactionSource; sourceId: string;
  postedDate: string; description: string; merchant: string; cashflowCents: number; currency: string;
  pending: boolean; removed: boolean; sourceHash: string;
  kind: TransactionKind; category: Category; country: string; countrySource: 'bank' | 'default' | 'manual';
  notes: string; raw: Record<string, unknown>;
};

export const splitSchema = z.object({
  id: z.string().optional(), description: z.string().max(200).default(''),
  cashflowCents: z.number().int().safe(), category: categorySchema, country: countrySchema,
  kind: z.enum(['income', 'expense', 'refund', 'review', 'excluded']),
  excluded: z.boolean().optional(),
});
export type Split = z.infer<typeof splitSchema>;
export const overrideSchema = z.object({
  revision: z.number().int().nonnegative(), updatedAt: z.string(),
  kind: kindSchema.optional(), category: categorySchema.optional(), country: countrySchema.optional(),
  notes: z.string().max(2000).optional(), excluded: z.boolean().optional(),
  splits: z.array(splitSchema).optional(), duplicateOf: z.string().nullable().optional(),
});
export type TransactionOverride = z.infer<typeof overrideSchema>;
export const classificationSchema = z.object({
  provider: z.enum(['codex', 'claude']).optional(),
  sourceHash: z.string(), kind: kindSchema, category: categorySchema, country: countrySchema,
  countrySource: z.enum(['ai', 'default']), reason: z.string().max(1000),
  needsReview: z.boolean(), classifiedAt: z.string(), classifierVersion: z.string(),
});
export type Classification = z.infer<typeof classificationSchema>;
export type LedgerRow = Omit<SourceTransaction, 'raw' | 'countrySource'> & {
  countrySource: 'bank' | 'default' | 'manual' | 'ai';
  accountName: string; accountMask: string; institution: string; version: string;
  parentId: string; splitId?: string; splitCount: number; needsReview: boolean;
  categoryExcluded?: boolean;
  reason: string; classificationSource: 'rules' | 'manual' | 'codex' | 'claude';
  excluded: boolean; duplicateOf?: string | null;
  classifiedAt?: string; classifierVersion?: string;
};
// Missing spending/income categories need attention without making the cashflow uncertain.
export function isAwaitingReview(row: Pick<LedgerRow, 'kind' | 'category' | 'needsReview' | 'excluded' | 'categoryExcluded'>): boolean {
  return !row.excluded && !row.categoryExcluded && row.kind !== 'excluded' && (row.kind === 'review' || row.needsReview
    || (row.category === 'uncategorized' && ['expense', 'income', 'refund'].includes(row.kind)));
}
export const ledgerRowSchema = z.object({
  id: z.string(), accountId: z.string(), source: sourceSchema, sourceId: z.string(), postedDate: dateSchema,
  description: z.string(), merchant: z.string(), cashflowCents: z.number().int().safe(), currency: z.string(),
  pending: z.boolean(), removed: z.boolean(), sourceHash: z.string(), kind: kindSchema, category: categorySchema, country: countrySchema,
  countrySource: z.enum(['bank', 'default', 'manual', 'ai']), notes: z.string(), accountName: z.string(), accountMask: z.string(), institution: z.string(),
  version: z.string(), parentId: z.string(), splitId: z.string().optional(), splitCount: z.number().int().nonnegative(), needsReview: z.boolean(), reason: z.string(),
  categoryExcluded: z.boolean().optional(),
  classificationSource: z.enum(['rules', 'manual', 'codex', 'claude']), excluded: z.boolean(), duplicateOf: z.string().nullable().optional(),
  classifiedAt: z.string().optional(), classifierVersion: z.string().optional(),
});
export const manualTransactionInput = z.object({
  accountId: z.string(), postedDate: dateSchema, description: z.string().trim().min(1).max(500),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, t("Enter a positive amount with at most two decimal places")),
  kind: z.enum(['income', 'expense', 'refund', 'transfer', 'payment', 'investment', 'reinvestment', 'review']),
  category: categorySchema.default('uncategorized'), country: countrySchema.default('US'),
  notes: z.string().max(2000).default(''),
});
export const overrideInput = overrideSchema.omit({ revision: true, updatedAt: true, splits: true, duplicateOf: true }).extend({ version: z.string() });
export const splitsInput = z.object({ version: z.string(), splits: z.array(splitSchema).max(100) });
export type Summary = { incomeCents: number; expenseCents: number; netCents: number; reviewCents: number; reviewCount: number; transactionCount: number };
export type CategorySpending = { category: Category; expenseCents: number; refundCents: number };
export type MonthSummary = Summary & {
  month: string; stale: boolean; incompleteAccounts: string[];
  spendingIncomeRatio: number | null;
  grossExpenseCents: number; refundCents: number; categories: CategorySpending[];
};
export type OverviewData = { months: MonthSummary[] };

export function categoryLabel(id: string) { return translate(getLocale(), categoryOptions.find(([key]) => key === canonicalCategory(id))?.[1] || id); }
export function countryLabel(code: string) { return translate(getLocale(), countryOptions.find(([key]) => key === code)?.[1] || code); }
const pacificDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
});
export function today(now = new Date()) {
  const parts = pacificDate.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function monthRange(month: string, reference = today()): DateRange {
  const lastDay = new Date(`${month}-01T12:00:00Z`);
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
  const end = lastDay.toISOString().slice(0, 10);
  return { start: `${month}-01`, end: end > reference ? reference : end };
}
