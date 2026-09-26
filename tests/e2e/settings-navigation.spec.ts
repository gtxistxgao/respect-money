import { selectOption } from './select.js';
import { expect, test } from '@playwright/test';
import { translate } from '../../src/i18n/index.js';

const tr = (key: string) => translate('zh', key);

test('settings sidebar links scroll to sections and preserve deep links across reloads', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('link', { name: tr('Settings'), exact: true }).click();
  const navigation = page.getByRole('navigation', { name: tr('Settings'), exact: true });
  await expect(navigation).toBeVisible();
  await expect(page.getByRole('navigation', { name: tr('Month navigation') })).toHaveCount(0);
  const sections = [['history', 'Historical data coverage'], ['language', 'Language'], ['accounts', 'My accounts'], ['bank-connections', 'Bank connections'], ['classification', 'Automatic classification']] as const;
  for (const [id, label] of sections) {
    await navigation.getByRole('link', { name: tr(label), exact: true }).click();
    await expect(page).toHaveURL(new RegExp('/settings#' + id + '$'));
    await expect(page.locator('#' + id)).toBeFocused();
    await expect.poll(async () => (await page.locator('#' + id + ' h2').boundingBox())!.y).toBeGreaterThanOrEqual(0);
    await expect.poll(async () => (await page.locator('#' + id + ' h2').boundingBox())!.y).toBeLessThan(800);
    await expect(navigation.getByRole('link', { name: tr(label), exact: true })).toHaveAttribute('aria-current', 'location');
  }
  await navigation.getByRole('link', { name: tr('Historical data coverage'), exact: true }).click();
  await page.reload();
  await expect(page.locator('#history')).toBeFocused();
  await expect.poll(async () => (await page.locator('#history h2').boundingBox())!.y).toBeLessThan(800);
  await navigation.getByRole('link', { name: tr('Language'), exact: true }).click();
  await selectOption(page.getByRole('combobox', { name: tr('Language'), exact: true }), 'en');
  const englishNavigation = page.getByRole('navigation', { name: 'Settings', exact: true });
  await expect(englishNavigation.getByRole('link', { name: 'Historical data coverage', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await englishNavigation.getByRole('link', { name: 'Historical data coverage', exact: true }).click();
  await expect.poll(async () => (await page.locator('#history h2').boundingBox())!.y).toBeLessThan(844);
  await englishNavigation.getByRole('link', { name: 'Language', exact: true }).click();
  await expect(page.locator('#language')).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('settings-section-mobile.png'), fullPage: true, animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
