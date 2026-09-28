import { selectOption } from './select.js';
import { translate } from '../../src/i18n/index.js';
const tr = (key: string, params?: Record<string, string | number>) => translate('zh', key, params);
import { expect, test } from '@playwright/test';

for (const category of ['internal_transfer', 'investment_transaction'] as const) {
test(`marks income, expenses and review rows as ${category} and handles editing and split portions`, async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const account = await (await request.post('/api/accounts/manual', { data: { name: 'Internal transfer fixture', institution: 'Test', type: 'checking' } })).json();
  const ids: Record<string, string> = {};
  for (const [description, amount, kind, category] of [
    ['Outgoing transfer', '100.00', 'expense', 'shopping'], ['Incoming transfer', '75.00', 'income', 'salary'], ['Unconfirmed transfer', '25.00', 'review', 'uncategorized'],
  ]) {
    const created = await request.post('/api/transactions/manual', { data: { accountId: account.id, postedDate: '2026-06-15', country: 'US', description, amount, kind, category } });
    expect(created.ok()).toBe(true);
    ids[description] = (await created.json()).id;
  }
  await page.goto(`/?month=2026-06&accounts=${account.id}`);
  await expect(page.getByRole('button', { name: new RegExp(tr("Total spending")) })).toContainText('$100.00');
  await selectOption(page.getByRole('combobox', { name: tr("Change category for {p0}", { p0: "Outgoing transfer" }), exact: true }), category);
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await expect(page.getByRole('button', { name: new RegExp(tr("Total spending")) })).toContainText('$0.00');
  await page.getByRole('button', { name: new RegExp(tr("Total income")) }).click();
  await selectOption(page.getByRole('combobox', { name: tr("Change category for {p0}", { p0: "Incoming transfer" }), exact: true }), category);
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await expect(page.getByRole('button', { name: new RegExp(tr("Total income")) })).toContainText('$0.00');
  await page.getByRole('button', { name: new RegExp("^" + tr("Needs review")) }).click();
  await selectOption(page.getByRole('combobox', { name: tr("Change category for {p0}", { p0: "Unconfirmed transfer" }), exact: true }), category);
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await page.getByRole('button', { name: tr("All transactions"), exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await expect(page.locator('tbody tr').filter({ hasText: 'Incoming transfer' }).locator('.amount-cell')).toHaveText('+$75.00');
  await expect(page.locator('tbody tr').filter({ hasText: 'Outgoing transfer' }).locator('.amount-cell')).toHaveText('−$100.00');
  await expect(page.locator('tbody').getByText(tr("Excluded from income and spending"))).toHaveCount(3);

  await page.getByRole('button', { name: tr("Edit {p0}", { p0: "Incoming transfer" }), exact: true }).click();
  await expect(page.getByLabel(tr("Categories"), { exact: true })).toHaveAttribute('data-value', category);
  await page.getByLabel(tr("Notes (optional)")).fill('Keep incoming direction');
  await page.getByRole('button', { name: tr("Save transaction"), exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  const incoming = await (await request.get(`/api/transactions/${ids['Incoming transfer']}`)).json();
  expect(incoming.transaction).toMatchObject({ kind: 'income', cashflowCents: 7500, category: category, notes: 'Keep incoming direction' });
  const selector = page.getByRole('combobox', { name: tr("Change category for {p0}", { p0: "Incoming transfer" }), exact: true });
  await selectOption(selector, 'salary');
  await expect(selector).toBeEnabled();
  await expect(page.getByRole('button', { name: new RegExp(tr("Total income")) })).toContainText('$75.00');

  await page.getByRole('button', { name: tr("Split {p0}", { p0: "Outgoing transfer" }), exact: true }).click();
  await page.getByLabel(tr("Description"), { exact: true }).fill('Transfer portion');
  await page.getByLabel(tr("Amount (USD)"), { exact: true }).fill('70.00');
  await page.getByRole('button', { name: tr("Add split"), exact: true }).click();
  await page.getByLabel(tr("Description"), { exact: true }).nth(1).fill('Lunch portion');
  await selectOption(page.getByLabel(tr("Categories"), { exact: true }).nth(1), 'dining');
  await page.getByRole('button', { name: tr("Save split"), exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: new RegExp(tr("Total spending")) })).toContainText('$30.00');
  const transferPart = page.getByRole('combobox', { name: tr("Change category for {p0}", { p0: "Transfer portion" }), exact: true });
  await selectOption(transferPart, 'childcare');
  await expect(transferPart).toBeEnabled();
  await expect(page.getByRole('button', { name: new RegExp(tr("Total spending")) })).toContainText('$100.00');
  await selectOption(transferPart, category);
  await expect(transferPart).toBeEnabled();
  await page.getByRole('button', { name: new RegExp(tr("Total spending")) }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.getByRole('region', { name: tr("Spending by category"), exact: true }).getByRole('link', { name: new RegExp(tr("Dining")) })).toContainText('100%');
  const overview = await (await request.get(`/api/accounting/overview?accounts=${account.id}`)).json();
  expect(overview.months[0]).toMatchObject({ incomeCents: 7500, expenseCents: 3000, reviewCount: 0, categories: [{ category: 'dining', expenseCents: 3000, refundCents: 0 }] });
  await page.getByRole('button', { name: tr("All transactions"), exact: true }).click();
  await page.locator('.transaction-table').screenshot({ path: `test-results/${category}-desktop.png`, animations: 'disabled' });
  expect(errors).toEqual([]);
});
}
