import { test, expect } from '@playwright/test';
import { translate } from '../../src/i18n/index.js';
import type { WealthAccount, WealthSummary } from '../../src/shared/wealth.js';

const tr = (key: string) => translate('zh', key);
function account(id: string, institution: string, name: string, mask: string, type: WealthAccount['type'], netCents: number | null, fetchedAt: string): WealthAccount {
  return { id, institution, name, mask, type, included: true, balance: netCents === null ? null : { netCents, fetchedAt, currency: 'USD', debtAccount: netCents < 0, allocation: [], allocationIncomplete: false } };
}

test('groups accounts by institution and sorts every balance column on desktop and mobile', async ({ page }, testInfo) => {
  const accounts = [
    account('vacation', 'Chase', 'Vacation', '0100', 'savings', 2000000, '2026-01-02T19:00:00Z'),
    account('brokerage', 'Schwab', 'Brokerage', '3333', 'investment', 100000, '2026-06-01T19:00:00Z'),
    account('everyday', 'Chase', 'Everyday', '0099', 'checking', 9000, '2025-12-31T19:00:00Z'),
    account('card', 'Amex', 'Card', '9999', 'credit', -50000, '2026-09-22T19:00:00Z'),
    account('missing', 'Schwab', 'Missing', '', 'other', null, ''),
  ];
  const summary: WealthSummary = { displayConversion: { enabled: true, currency: 'CNY', rate: 6.7 }, accounts, assets: [], assetsCents: 2109000, debtsCents: 50000, netWorthCents: 2059000, missingAccounts: 1, usdCnyRate: 6.7, allocation: [], errors: [], refreshing: false, needsRefresh: false, lastAttemptAt: '2026-09-22T19:00:00Z' };
  await page.route('**/api/wealth', (route) => route.fulfill({ json: summary }));
  await page.goto('/wealth/accounts');
  const table = page.getByRole('table', { name: tr('Account balances'), exact: true });
  const names = table.locator('tbody th');
  await expect(names).toHaveText(['Card', 'Everyday', 'Vacation', 'Brokerage', 'Missing']);
  await expect(table.getByRole('checkbox')).toHaveCount(0);
  const institution = table.getByRole('columnheader', { name: tr('Institution name'), exact: true });
  await expect(institution).toHaveAttribute('aria-sort', 'ascending');
  const tones = await table.locator('tbody tr').evaluateAll((rows) => rows.map((row) => getComputedStyle(row).backgroundColor));
  expect(tones[1]).toBe(tones[2]); expect(tones[3]).toBe(tones[4]); expect(tones[0]).not.toBe(tones[1]);
  await table.getByRole('button', { name: tr('Account name'), exact: true }).click();
  await expect(names).toHaveText(['Brokerage', 'Card', 'Everyday', 'Missing', 'Vacation']);
  await table.getByRole('button', { name: tr('Last four digits'), exact: true }).click();
  await expect(names).toHaveText(['Everyday', 'Vacation', 'Brokerage', 'Card', 'Missing']);
  await table.getByRole('button', { name: tr('Balance'), exact: true }).click();
  await expect(names).toHaveText(['Card', 'Everyday', 'Brokerage', 'Vacation', 'Missing']);
  await table.getByRole('button', { name: tr('Balance'), exact: true }).click();
  await expect(names).toHaveText(['Vacation', 'Brokerage', 'Everyday', 'Card', 'Missing']);
  await expect(table.getByRole('columnheader', { name: tr('Balance'), exact: true })).toHaveAttribute('aria-sort', 'descending');
  await table.getByRole('button', { name: tr('Updated (PT)'), exact: true }).click();
  await expect(names).toHaveText(['Everyday', 'Vacation', 'Brokerage', 'Card', 'Missing']);
  await table.getByRole('button', { name: tr('Updated (PT)'), exact: true }).click();
  await expect(names).toHaveText(['Card', 'Brokerage', 'Vacation', 'Everyday', 'Missing']);
  await table.getByRole('button', { name: tr('Account type'), exact: true }).click();
  await expect(table.getByRole('columnheader', { name: tr('Account type'), exact: true })).toHaveAttribute('aria-sort', 'ascending');
  await expect(table.locator('tbody .account-col-type')).toContainText([tr('Savings'), tr('Other'), tr('Investment account'), tr('Credit card'), tr('Checking')]);
  await institution.getByRole('button').click();
  await expect(names).toHaveText(['Card', 'Everyday', 'Vacation', 'Brokerage', 'Missing']);
  await page.screenshot({ path: testInfo.outputPath('account-groups-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const scroll = page.locator('.wealth-balances .wealth-accounts-scroll');
  expect(await scroll.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await table.getByRole('button', { name: tr('Balance'), exact: true }).click();
  await expect(names).toHaveText(['Card', 'Everyday', 'Brokerage', 'Vacation', 'Missing']);
  await page.screenshot({ path: testInfo.outputPath('account-sorting-mobile.png'), fullPage: true });
});
