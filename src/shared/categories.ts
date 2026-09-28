import { z } from 'zod';
import { message as t } from '../i18n/index.js';

export const categoryOptions = [
  ['dining', 'Dining'], ['groceries', 'Groceries'], ['housing', 'Housing'], ['transport', 'Transport'],
  ['shopping', 'Shopping'], ['health', 'Health'], ['childcare', 'Childcare'], ['entertainment', 'Entertainment'], ['travel', 'Travel'],
  ['side_business', 'Side business'], ['salary', 'Salary'], ['investments', 'Investments'], ['interest', 'Interest'], ['dividends', 'Dividends'],
  ['investment_transaction', 'Investment transaction'], ['internal_transfer', 'Internal transfer'], ['credit_card_payment', 'Credit card payment'], ['uncategorized', 'Uncategorized'],
] as const;
export const categoryIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
export const categoryDefinitionSchema = z.strictObject({
  id: categoryIdSchema, name: z.string().trim().min(1).max(80),
  prompt: z.string().trim().max(2000), includeInCashflow: z.boolean(),
});
export type CategoryDefinition = z.infer<typeof categoryDefinitionSchema>;
export const categoryDefinitionsSchema = z.array(categoryDefinitionSchema).min(1).max(100).superRefine((rows, ctx) => {
  if (!rows.some(row => row.id === 'uncategorized')) ctx.addIssue({ code: 'custom', message: t('Uncategorized must remain available.') });
  if (new Set(rows.map(row => row.id)).size !== rows.length || new Set(rows.map(row => row.name.toLocaleLowerCase())).size !== rows.length) ctx.addIssue({ code: 'custom', message: t('Category IDs and names must be unique.') });
});
const prompts: Record<string, string> = {
  dining: 'Restaurants, cafes, takeaway and food delivery.', groceries: 'Groceries and household food shopping.',
  housing: 'Housing, rent, utilities and home maintenance.', transport: 'Local transport, fuel, parking and public transit.',
  shopping: 'Retail purchases not covered by a more specific category.', health: 'Medical care, dental care, medicine and health services.',
  childcare: 'Childcare, baby supplies, diapers, formula, children’s clothing, toys and education. Do not infer from a general retailer alone.',
  entertainment: 'Entertainment, hobbies, subscriptions and leisure activities.', travel: 'Flights, hotels and travel activities, including ticket and hotel refunds.',
  side_business: 'Side business or freelance activities, including customer payments, business purchases and refunds.',
  salary: 'Employment and payroll-related transactions.', investments: 'Investment-related cash income and standalone fees, excluding securities purchases and sales.',
  interest: 'Interest-related transactions.', dividends: 'Dividend-related transactions.',
  investment_transaction: 'Securities purchases, sales and automatic reinvestments. These exchange cash and investment assets.',
  internal_transfer: 'Established transfers between the owner’s own accounts. Do not assume ambiguous Zelle, Venmo or friend payments are own-account transfers.',
  credit_card_payment: 'Credit card repayments on either side: the bank debit or the card credit. Not a purchase or a purchase refund.',
  uncategorized: 'Use when no configured category is supported by the supplied evidence.',
};
export const defaultCategories: CategoryDefinition[] = categoryOptions.map(([id, name]) => ({ id, name, prompt: prompts[id], includeInCashflow: !['internal_transfer', 'investment_transaction', 'credit_card_payment'].includes(id) }));
export type CategoryConfiguration = { categoryDefinitions?: CategoryDefinition[]; categoryRedirects?: Record<string, string> };
export function resolveCategories(settings?: CategoryConfiguration): CategoryDefinition[] { return settings?.categoryDefinitions ?? defaultCategories; }
export function canonicalCategory(value: unknown) {
  return value === 'investment_income' || value === 'investment_fees' ? 'investments' : value === 'side_business_expenses' ? 'side_business' : value;
}
export function resolveCategoryId(id: string, settings?: CategoryConfiguration): string {
  let current = canonicalCategory(id) as string;
  const seen = new Set<string>();
  while (settings?.categoryRedirects?.[current] && !seen.has(current)) { seen.add(current); current = settings.categoryRedirects[current]; }
  return resolveCategories(settings).some(row => row.id === current) ? current : 'uncategorized';
}
