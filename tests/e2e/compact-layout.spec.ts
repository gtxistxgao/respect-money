import { expect, test } from '@playwright/test';
import { translate } from '../../src/i18n/index.js';

const tr = (key: string) => translate('zh', key);

test('keeps the compact ledger readable and scrolls wide data inside phone screens', async ({ page, request }, testInfo) => {
  const account = await (await request.post('/api/accounts/manual', { data: { name: 'Design preview', institution: 'Fixture bank', type: 'credit', mask: '0123' } })).json();
  for (const [description, amount, category] of [
    ['Neighborhood cafe', '24.50', 'dining'], ['Weekly groceries', '128.60', 'groceries'],
    ['Train ticket', '8.00', 'transport'], ['Bookshop', '36.00', 'shopping'],
  ]) {
    expect((await request.post('/api/transactions/manual', { data: { accountId: account.id, postedDate: '2026-02-12', description, amount, category, kind: 'expense', country: 'US' } })).ok()).toBe(true);
  }
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.goto(`/?month=2026-02&accounts=${account.id}`);
    await expect(page.locator('tbody tr')).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width < 760) {
      const rail = page.getByRole('navigation', { name: tr('Month navigation') });
      const railBounds = (await rail.boundingBox())!;
      const active = (await rail.locator('[aria-current="date"]').boundingBox())!;
      expect(active.x).toBeGreaterThanOrEqual(railBounds.x);
      expect(active.x + active.width).toBeLessThanOrEqual(railBounds.x + railBounds.width + 1);
      expect(await page.locator('.transaction-table').evaluate((table) => parseFloat(getComputedStyle(table).fontSize))).toBeLessThanOrEqual(11);
      expect(await page.locator('.table-scroll').evaluate((table) => table.scrollWidth > table.clientWidth)).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath(`ledger-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: tr('Add transaction'), exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const modal = (await page.getByRole('dialog').boundingBox())!;
    expect(modal.x).toBeGreaterThanOrEqual(0);
    expect(modal.x + modal.width).toBeLessThanOrEqual(width);
    await page.getByRole('button', { name: tr('Cancel'), exact: true }).click();
  }
});
