import { selectOption } from './select.js';
import { translate } from '../../src/i18n/index.js';
const tr = (key: string, params?: Record<string, string | number>) => translate('zh', key, params);
import { expect, test, type APIRequestContext } from '@playwright/test';

async function fixture(request: APIRequestContext) {
  const account = await (await request.post('/api/accounts/manual', { data: { name: 'Inline category fixture', institution: 'Test', type: 'credit', mask: '2468' } })).json();
  const created = await request.post('/api/transactions/manual', { data: {
    accountId: account.id, postedDate: '2026-06-12', description: 'Category test purchase', amount: '100.00',
    kind: 'expense', category: 'dining', country: 'JP', notes: 'Keep this note',
  } });
  expect(created.ok()).toBe(true);
  const { id } = await created.json();
  return { id, url: `/?month=2026-06&accounts=${account.id}` };
}

test('saves categories in the table, refreshes charts and filters, and edits only the selected split', async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const { id, url } = await fixture(request);
  await page.goto(url);
  const category = page.getByRole('combobox', { name: tr("Change category for {p0}", { p0: "Category test purchase" }), exact: true });
  await expect(category).toHaveAttribute('data-value', 'dining');
  await category.click();
  await page.keyboard.press('Escape');
  await expect(category).toHaveAttribute('data-value', 'dining');
  await selectOption(category, 'groceries');
  await expect(category).toBeEnabled();
  await expect(category).toHaveAttribute('data-value', 'groceries');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('region', { name: tr("Spending by category"), exact: true }).getByRole('link', { name: new RegExp(tr("Groceries")) })).toContainText('100%');
  await expect(page.getByRole('button', { name: new RegExp(tr("Total spending")) })).toContainText('$100.00');
  await page.reload();
  await expect(category).toHaveAttribute('data-value', 'groceries');
  const detail = await (await request.get(`/api/transactions/${id}`)).json();
  expect(detail.transaction).toMatchObject({ category: 'groceries', country: 'JP', notes: 'Keep this note', cashflowCents: -10000, kind: 'expense' });

  const splitResponse = await request.put(`/api/transactions/${id}/splits`, { data: { version: detail.version, splits: [
    { description: 'Lunch portion', cashflowCents: -7000, category: 'dining', country: 'JP', kind: 'expense' },
    { description: 'Shopping portion', cashflowCents: -3000, category: 'shopping', country: 'CN', kind: 'expense' },
  ] } });
  expect(splitResponse.ok()).toBe(true);
  const before = await (await request.get(`/api/transactions/${id}`)).json();
  await page.reload();
  const lunch = page.getByRole('combobox', { name: tr("Change category for {p0}", { p0: "Lunch portion" }), exact: true });
  await selectOption(lunch, 'health');
  await expect(lunch).toBeEnabled();
  await expect(lunch).toHaveAttribute('data-value', 'health');
  await expect(page.getByRole('combobox', { name: tr("Change category for {p0}", { p0: "Shopping portion" }), exact: true })).toHaveAttribute('data-value', 'shopping');
  const after = await (await request.get(`/api/transactions/${id}`)).json();
  expect(after.override.splits).toEqual([{ ...before.override.splits[0], category: 'health' }, before.override.splits[1]]);
  await expect(page.getByRole('button', { name: new RegExp(tr("Total spending")) })).toContainText('$100.00');
  await page.locator('.transaction-table').screenshot({ path: 'test-results/inline-category-desktop.png', animations: 'disabled' });

  await page.setViewportSize({ width: 390, height: 844 });
  await lunch.scrollIntoViewIfNeeded();
  await selectOption(lunch, 'travel');
  await expect(lunch).toBeEnabled();
  await expect(lunch).toHaveAttribute('data-value', 'travel');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/inline-category-mobile.png', animations: 'disabled' });
  await page.goto(`${url}&categories=travel`);
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await selectOption(page.getByRole('combobox', { name: tr("Change category for {p0}", { p0: "Lunch portion" }), exact: true }), 'transport');
  await expect(page.getByText(tr("No records match these filters"))).toBeVisible();
  await page.getByRole('button', { name: tr("Clear filters") }).click();
  await expect(page.getByRole('combobox', { name: tr("Change category for {p0}", { p0: "Lunch portion" }), exact: true })).toHaveAttribute('data-value', 'transport');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('keeps the saved category after failures and refreshes conflicting edits before retrying', async ({ page, request }) => {
  const { id, url } = await fixture(request);
  await page.goto(url);
  const category = page.getByRole('combobox', { name: tr("Change category for {p0}", { p0: "Category test purchase" }), exact: true });
  await expect(category).toHaveAttribute('data-value', 'dining');
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**/api/transactions/${id}/overrides`, async (route) => {
    await blocked;
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: tr("The category was not saved. Please retry.") }) });
  }, { times: 1 });
  await selectOption(category, 'groceries');
  await expect(category).toBeDisabled();
  await page.getByRole('button', { name: tr("Amount"), exact: true }).click();
  await expect(category).toBeDisabled();
  release();
  await expect(page.getByRole('alert')).toContainText(tr("The category was not saved. Please retry."));
  await expect(category).toBeEnabled();
  await expect(category).toHaveAttribute('data-value', 'dining');
  await selectOption(category, 'groceries');
  await expect(category).toBeEnabled();
  await expect(category).toHaveAttribute('data-value', 'groceries');
  await expect(page.getByRole('alert')).toHaveCount(0);

  const detail = await (await request.get(`/api/transactions/${id}`)).json();
  expect((await request.put(`/api/transactions/${id}/overrides`, { data: { version: detail.version, category: 'housing', notes: 'Edited in another session' } })).ok()).toBe(true);
  await selectOption(category, 'transport');
  await expect(page.getByRole('alert')).toContainText(tr("This transaction was updated. Refresh before editing it again."));
  await expect(category).toBeEnabled();
  await expect(category).toHaveAttribute('data-value', 'housing');
  await selectOption(category, 'transport');
  await expect(category).toBeEnabled();
  const saved = await (await request.get(`/api/transactions/${id}`)).json();
  expect(saved.override).toMatchObject({ category: 'transport', notes: 'Edited in another session' });
  await page.reload();
  await expect(category).toHaveAttribute('data-value', 'transport');
});
