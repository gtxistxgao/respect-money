import { expect, test } from '@playwright/test';
import { translate } from '../../src/i18n/index.js';

const tr = (key: string) => translate('zh', key);

test('column filters stay visible near viewport edges and apply category selections', async ({ page, request }) => {
  const account = await (await request.post('/api/accounts/manual', { data: { name: 'Column filter fixture', institution: 'Test', type: 'cash' } })).json();
  for (const category of ['dining', 'shopping']) {
    const response = await request.post('/api/transactions/manual', { data: { accountId: account.id, postedDate: '2026-08-10', description: `Filter fixture ${category}`, amount: '10.00', kind: 'expense', category, country: 'US' } });
    expect(response.ok()).toBe(true);
  }
  for (const viewport of [{ width: 1440, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`/?month=2026-08&accounts=${account.id}`);
    const trigger = page.getByLabel(tr('Filter categories'), { exact: true });
    await trigger.click();
    const menu = page.locator('.filter-popover:visible');
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    const dining = menu.getByRole('checkbox', { name: tr('Dining'), exact: true });
    await dining.click();
    await expect(dining).toBeChecked();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody')).toContainText('Filter fixture dining');
    await trigger.click();
    await expect(menu).toHaveCount(0);
    await page.getByRole('button', { name: tr('Clear filters'), exact: true }).click();
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await trigger.click();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await page.getByRole('button', { name: tr('Filter spending locations'), exact: true }).click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toHaveCount(1);
    await expect(menu.getByRole('checkbox', { name: tr('United States'), exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
  }
});

test('sorts the account column, selects multiple accounts and preserves filters across reloads', async ({ page, request }) => {
  for (const [name, mask, amount] of [['Zulu filter card', '9000', '30'], ['Alpha filter card', '1000', '10'], ['Alpha filter card', '2000', '20']]) {
    const account = await (await request.post('/api/accounts/manual', { data: { name, mask, institution: 'Fixture bank', type: 'cash' } })).json();
    expect((await request.post('/api/transactions/manual', { data: { accountId: account.id, postedDate: '2026-08-10', description: 'Account column fixture', amount, kind: 'expense', category: 'travel', country: 'US' } })).ok()).toBe(true);
  }
  await page.goto('/?month=2026-08&q=Account+column+fixture');
  const header = page.locator('thead .ledger-col-account');
  await header.getByRole('button', { name: tr('Account'), exact: true }).click();
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
  await expect(page.locator('tbody .ledger-col-account')).toHaveText(['Alpha filter card · 1000', 'Alpha filter card · 2000', 'Zulu filter card · 9000']);
  await header.getByRole('button', { name: tr('Account'), exact: true }).click();
  await expect(header).toHaveAttribute('aria-sort', 'descending');
  await expect(page.locator('tbody .ledger-col-account').first()).toContainText('Zulu filter card');
  await header.getByRole('button', { name: tr('Filter transaction accounts'), exact: true }).click();
  const menu = page.locator('.filter-popover:visible');
  await menu.getByRole('checkbox', { name: 'Alpha filter card · 1000 · Fixture bank', exact: true }).check();
  await menu.getByRole('checkbox', { name: 'Zulu filter card · 9000 · Fixture bank', exact: true }).check();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.locator('.table-footer')).toContainText('$40.00');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(header).toHaveAttribute('aria-sort', 'descending');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.getByRole('button', { name: tr('Clear filters'), exact: true })).toBeVisible();
  await page.getByRole('button', { name: tr('Clear filters'), exact: true }).click();
  await expect(page).not.toHaveURL(/transactionAccounts=/);
});
