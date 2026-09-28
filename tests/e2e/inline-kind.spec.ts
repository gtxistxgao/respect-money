import { expect, test } from '@playwright/test';
import { translate } from '../../src/i18n/index.js';
import { selectOption } from './select.js';
const tr = (key: string, params?: Record<string, string | number>) => translate('zh', key, params);

test('changes cash flow types in the table and preserves categories and excluded split portions', async ({ page, request }) => {
  const account = await (await request.post('/api/accounts/manual', { data: { name: 'Inline type fixture', institution: 'Fixture', type: 'cash' } })).json();
  const created = await request.post('/api/transactions/manual', { data: { accountId: account.id, postedDate: '2026-08-12', description: 'Fixture receipt', amount: '100', kind: 'income', category: 'travel', country: 'JP', notes: 'Keep note' } });
  expect(created.ok()).toBe(true);
  const id = (await created.json()).id;
  await page.goto(`/?month=2026-08&accounts=${account.id}&mode=income`);
  const type = page.getByRole('combobox', { name: tr('Change cash flow type for {p0}', { p0: 'Fixture receipt' }), exact: true });
  await type.click();
  await expect(page.getByRole('option', { name: tr('Spending'), exact: true })).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  await selectOption(type, 'refund');
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await expect(page.getByRole('button', { name: new RegExp(tr('Total income')) })).toContainText('$0.00');
  await expect(page.getByRole('button', { name: new RegExp(tr('Total refunds')) })).toContainText('$100.00');
  await page.getByRole('button', { name: tr('Refund details'), exact: true }).click();
  await expect(type).toHaveAttribute('data-value', 'refund');
  await page.reload();
  await expect(type).toHaveAttribute('data-value', 'refund');
  const detail = await (await request.get(`/api/transactions/${id}`)).json();
  expect(detail.transaction).toMatchObject({ cashflowCents: 10000, category: 'travel', country: 'JP', notes: 'Keep note', kind: 'refund' });
  expect((await request.put(`/api/transactions/${id}/splits`, { data: { version: detail.version, splits: [
    { cashflowCents: 6000, kind: 'income', category: 'travel', country: 'JP', description: 'First split' },
    { cashflowCents: 4000, kind: 'excluded', category: 'housing', country: 'US', description: 'Excluded split' },
  ] } })).ok()).toBe(true);
  await page.goto(`/?month=2026-08&accounts=${account.id}&mode=all`);
  const first = page.getByRole('combobox', { name: tr('Change cash flow type for {p0}', { p0: 'First split' }), exact: true });
  await selectOption(first, 'review');
  await expect(first).toBeEnabled();
  await expect(first).toHaveAttribute('data-value', 'review');
  const excluded = page.getByRole('combobox', { name: tr('Change cash flow type for {p0}', { p0: 'Excluded split' }), exact: true });
  await selectOption(excluded, 'refund');
  await expect(excluded).toBeEnabled();
  await expect(excluded).toHaveAttribute('data-value', 'refund');
  await expect(page.locator('tbody tr').filter({ hasText: 'Excluded split' }).locator('.cashflow-type-cell')).toContainText(tr('Excluded from income and spending'));
  const saved = await (await request.get(`/api/transactions/${id}`)).json();
  expect(saved.override.splits).toMatchObject([{ kind: 'review', cashflowCents: 6000, category: 'travel' }, { kind: 'refund', excluded: true, cashflowCents: 4000, category: 'housing' }]);
  await page.route(`**/api/transactions/${id}/splits`, route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture save failed' }) }), { times: 1 });
  await selectOption(first, 'income');
  await expect(page.getByRole('alert')).toContainText('Fixture save failed');
  await expect(first).toHaveAttribute('data-value', 'review');
  await selectOption(first, 'income');
  await expect(first).toBeEnabled();
  await expect(first).toHaveAttribute('data-value', 'income');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
