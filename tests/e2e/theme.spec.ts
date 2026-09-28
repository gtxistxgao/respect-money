import { expect, test } from '@playwright/test';
import { translate } from '../../src/i18n/index.js';

const tr = (key: string, params?: Record<string, string | number>) => translate('zh', key, params);
test.use({ reducedMotion: 'reduce' });

test('switches themes across pages, reloads and tabs with an accessible mobile control', async ({ page, context, request }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const account = await (await request.post('/api/accounts/manual', { data: { name: 'Theme fixture', institution: 'Test', type: 'checking' } })).json();
  expect((await request.post('/api/transactions/manual', { data: { accountId: account.id, postedDate: '2026-08-15', description: 'Theme fixture purchase', amount: '25.00', kind: 'expense', category: 'childcare', country: 'US' } })).ok()).toBe(true);
  await page.goto(`/?month=2026-08&accounts=${account.id}`);
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  const light = page.getByRole('button', { name: tr('Switch to light theme'), exact: true });
  const bounds = (await light.boundingBox())!;
  expect(bounds.x).toBeGreaterThan(1300);
  expect(bounds.y).toBeLessThan(60);
  await light.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(245, 247, 250)');
  await expect(page.locator('th.ledger-col-amount')).toHaveCSS('background-color', 'rgb(220, 232, 244)');
  await expect(page.getByRole('button', { name: tr('Switch to dark theme'), exact: true })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('light-accounting.png'), fullPage: true });
  await page.reload();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await page.getByRole('button', { name: tr('Edit {p0}', { p0: 'Theme fixture purchase' }), exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.getByRole('combobox', { name: tr('Categories'), exact: true }).click();
  await expect(page.getByRole('listbox')).toHaveCSS('background-color', 'rgb(237, 242, 247)');
  await page.screenshot({ path: testInfo.outputPath('light-dialog.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: tr('Cancel'), exact: true }).click();
  for (const name of ['Overview', 'Wealth', 'Settings']) {
    await page.getByRole('link', { name: tr(name), exact: true }).click();
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
    await expect(page.getByRole('heading', { name: tr(name), exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`light-${name.toLowerCase()}.png`), fullPage: true });
  }
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByRole('button', { name: tr('Switch to dark theme'), exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  const dark = page.getByRole('button', { name: tr('Switch to dark theme'), exact: true });
  await expect(dark).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: testInfo.outputPath('light-mobile.png') });
  await dark.click();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await expect(second.locator('html')).toHaveCSS('color-scheme', 'dark');
  await page.reload();
  await expect(page.getByRole('button', { name: tr('Switch to light theme'), exact: true })).toBeVisible();
  await second.close();
  expect(errors).toEqual([]);
});

test('restores light appearance before the application bundle loads', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('respect-money-theme', 'light'));
  await page.route('**/assets/*.js', route => route.abort());
  await page.goto('/');
  await expect(page.locator('#root')).toBeEmpty();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f5f7fa');
});

test('can switch themes when browser storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    for (const method of ['getItem', 'setItem']) Object.defineProperty(Storage.prototype, method, { value: () => { throw new Error('Storage unavailable'); } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: tr('Switch to light theme'), exact: true }).click();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await page.getByRole('button', { name: tr('Switch to dark theme'), exact: true }).click();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
});
