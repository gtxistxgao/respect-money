import { selectOption } from './select.js';
import { translate } from '../../src/i18n/index.js';
const tr = (key: string, params?: Record<string, string | number>) => translate('zh', key, params);
import { expect, test } from '@playwright/test';

test('shows actual incoming and outgoing signs for transactions awaiting review', async ({ page, request }) => {
  const account = await (await request.post('/api/accounts/manual', { data: { name: 'Review direction fixture', institution: 'Test', type: 'checking' } })).json();
  for (const [description, amount, kind] of [['Pending outgoing', '50.00', 'review'], ['Pending incoming', '75.00', 'income']]) {
    const created = await request.post('/api/transactions/manual', { data: {
      accountId: account.id, postedDate: '2026-06-15', description, amount, kind, category: 'uncategorized', country: 'US',
    } });
    expect(created.ok()).toBe(true);
    if (kind === 'income') {
      const { id } = await created.json();
      const detail = await (await request.get(`/api/transactions/${id}`)).json();
      expect((await request.put(`/api/transactions/${id}/overrides`, { data: { version: detail.version, kind: 'review' } })).ok()).toBe(true);
    }
  }

  await page.goto(`/?month=2026-06&accounts=${account.id}`);
  await page.getByRole('button', { name: new RegExp("^" + tr("Needs review")) }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  const incoming = page.locator('tbody tr').filter({ hasText: 'Pending incoming' }).locator('.amount-cell');
  const outgoing = page.locator('tbody tr').filter({ hasText: 'Pending outgoing' }).locator('.amount-cell');
  await expect(incoming).toHaveText('+US$75.00');
  await expect(incoming).toHaveClass(/income-text/);
  await expect(outgoing).toHaveText('−US$50.00');
  await expect(outgoing).not.toHaveClass(/income-text/);
  await expect(page.getByRole('button', { name: new RegExp(tr("Total income")) })).toContainText('$0.00');
  await expect(page.getByRole('button', { name: new RegExp(tr("Total spending")) })).toContainText('$0.00');
  await expect(page.locator('.table-footer')).toContainText(tr("Amount awaiting review") + " US$125.00");
  await page.locator('.transaction-table').screenshot({ path: 'test-results/review-amounts-desktop.png', animations: 'disabled' });
  await page.reload();
  await expect(incoming).toHaveText('+US$75.00');
  await expect(outgoing).toHaveText('−US$50.00');
  await page.getByRole('button', { name: tr("All transactions"), exact: true }).click();
  await expect(incoming).toHaveText('+US$75.00');
  await expect(outgoing).toHaveText('−US$50.00');
  await page.getByRole('button', { name: new RegExp('^' + tr('Needs review')) }).click();
  await selectOption(page.getByRole('combobox', { name: tr('Change category for {p0}', { p0: 'Pending outgoing' }), exact: true }), 'childcare');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).not.toContainText('Pending outgoing');
  await selectOption(page.getByRole('combobox', { name: tr('Change category for {p0}', { p0: 'Pending incoming' }), exact: true }), 'salary');
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await expect(page.getByRole('button', { name: new RegExp(tr('Total spending')) })).toContainText('$50.00');
  await expect(page.getByRole('button', { name: new RegExp(tr('Total income')) })).toContainText('$75.00');
  await page.reload();
  await expect(page.locator('tbody tr')).toHaveCount(0);
  const created = await request.post('/api/transactions/manual', { data: { accountId: account.id, postedDate: '2026-06-15', description: 'Dialog review fixture', amount: '20.00', kind: 'review', category: 'uncategorized', country: 'US' } });
  expect(created.ok()).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: tr('Edit {p0}', { p0: 'Dialog review fixture' }), exact: true }).click();
  await selectOption(page.getByLabel(tr('Categories'), { exact: true }), 'groceries');
  await expect(page.getByRole('combobox', { name: tr('Transaction type'), exact: true })).toHaveAttribute('data-value', 'expense');
  await page.getByRole('button', { name: tr('Save transaction'), exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await expect(page.getByRole('button', { name: new RegExp(tr('Total spending')) })).toContainText('$70.00');
});
