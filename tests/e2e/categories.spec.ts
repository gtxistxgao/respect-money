import { expect, test } from '@playwright/test';
import { translate } from '../../src/i18n/index.js';
import { selectOption } from './select.js';
const tr = (key: string) => translate('zh', key);

test('configures a category and stacks spending, income, refund and balance cards with independent details', async ({ page, request }) => {
  await page.goto('/settings#categories');
  const section = page.locator('#categories');
  await section.getByRole('button', { name: tr('Add category'), exact: true }).click();
  await section.getByLabel(tr('Category name'), { exact: true }).filter({ visible: true }).fill('Fixture studio');
  await section.getByLabel(tr('AI category instructions'), { exact: true }).filter({ visible: true }).fill('Fixture studio purchases, receipts and refunds.');
  await section.getByRole('button', { name: tr('Save category'), exact: true }).filter({ visible: true }).click();
  await expect(section.getByRole('status')).toHaveText(tr('Categories saved.'));
  const catalog = await (await request.get('/api/categories')).json();
  const category = catalog.categories.find((row: { name: string }) => row.name === 'Fixture studio');
  const account = await (await request.post('/api/accounts/manual', { data: { name: 'Category fixture', institution: 'Fixture', type: 'cash' } })).json();
  for (const [kind, amount] of [['income', '100'], ['expense', '40'], ['refund', '10']]) {
    expect((await request.post('/api/transactions/manual', { data: { accountId: account.id, postedDate: '2026-08-01', category: category.id, kind, amount, description: `Studio ${kind}` } })).ok()).toBe(true);
  }
  const url = `/?month=2026-08&accounts=${account.id}`;
  await page.goto(url);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const cards = page.locator('.summary-grid > .summary-panel');
    await expect(cards).toHaveCount(4);
    await expect(cards.nth(0)).toContainText(tr('Total spending'));
    await expect(cards.nth(1)).toContainText(tr('Total income'));
    await expect(cards.nth(2)).toContainText(tr('Total refunds'));
    await expect(cards.nth(3)).toContainText(tr('Monthly balance'));
    await expect(cards.nth(3)).toContainText('$70.00');
    await expect(cards.nth(3)).toHaveClass(/positive/);
    const bounds = await Promise.all([0, 1, 2, 3].map(index => cards.nth(index).boundingBox()));
    expect(bounds[0]!.y + bounds[0]!.height).toBeLessThan(bounds[1]!.y);
    expect(bounds[1]!.y + bounds[1]!.height).toBeLessThan(bounds[2]!.y);
    expect(bounds[2]!.y + bounds[2]!.height).toBeLessThan(bounds[3]!.y);
    expect(bounds[2]!.width).toBe(bounds[3]!.width);
    expect(bounds[0]!.x).toBe(bounds[1]!.x);
    expect(bounds[1]!.width).toBe(bounds[2]!.width);
  }
  await page.getByRole('button', { name: new RegExp(tr('Total refunds')) }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('Studio refund');
  await expect(page.locator('tbody .amount-cell')).toContainText('+US$10.00');
  await expect(page.locator('thead .ledger-col-category')).toContainText(tr('Category'));
  await expect(page.locator('thead .ledger-col-kind')).toHaveText(tr('Cash flow type'));
  await expect(page.locator('tbody .ledger-col-kind')).toHaveText(tr('Refund'));
  await expect(page.locator('tbody .ledger-col-category')).not.toContainText(tr('Refund'));
  await expect(page.locator('.category-footnote')).toHaveCount(0);
  await page.goto('/settings#categories');
  const editor = section.locator('details').filter({ hasText: 'Fixture studio' });
  await editor.locator('summary').click();
  await editor.getByLabel(tr('Include this category in income and spending')).uncheck();
  await editor.getByRole('button', { name: tr('Save category'), exact: true }).click();
  await expect(section.getByRole('status')).toHaveText(tr('Categories saved.'));
  await page.goto(url);
  await expect(page.getByRole('button', { name: new RegExp(tr('Total income')) })).toContainText('$0.00');
  await expect(page.getByRole('button', { name: new RegExp(tr('Total refunds')) })).toContainText('$0.00');
  await page.goto('/settings#categories');
  await editor.locator('summary').click();
  await editor.getByRole('button', { name: tr('Delete category'), exact: true }).click();
  await selectOption(editor.getByLabel(tr('Move existing transactions to')), 'side_business');
  await editor.getByRole('button', { name: tr('Move transactions and delete category'), exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.goto(url);
  await expect(page.getByRole('button', { name: new RegExp(tr('Total spending')) })).toContainText('$30.00');
  await expect(page.getByRole('button', { name: new RegExp(tr('Total refunds')) })).toContainText('$10.00');
});
