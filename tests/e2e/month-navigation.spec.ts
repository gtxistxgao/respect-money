import { selectOption } from './select.js';
import { expect, test } from '@playwright/test';
import { shortMonth, translate } from '../../src/i18n/index.js';

const tr = (key: string) => translate('zh', key);

test('year selection includes empty months, hides future months and works on mobile', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-09-07T12:00:00Z'));
  await page.goto('/?month=2026-08&mode=income');
  const year = page.getByRole('combobox', { name: tr('Select year'), exact: true });
  const navigation = page.getByRole('navigation', { name: tr('Month navigation') });
  const buttons = navigation.getByRole('button');
  await expect(year).toHaveAttribute('data-value', '2026');
  await expect(buttons).toHaveCount(9);
  for (let index = 0; index < 9; index++) await expect(buttons.nth(index)).toContainText(shortMonth(`2026-${String(9 - index).padStart(2, '0')}`, 'zh'));
  await selectOption(year, '2025');
  await expect(buttons).toHaveCount(12);
  for (let index = 0; index < 12; index++) await expect(buttons.nth(index)).toContainText(shortMonth(`2025-${String(12 - index).padStart(2, '0')}`, 'zh'));
  await buttons.first().click();
  await expect(page).toHaveURL(/month=2025-12/);
  await expect(buttons.first()).toHaveAttribute('aria-current', 'date');
  await page.reload();
  await expect(year).toHaveAttribute('data-value', '2025');
  await selectOption(year, '2026');
  await expect(page).toHaveURL(/month=2026-09/);
  expect(new URL(page.url()).searchParams.get('mode')).toBe('income');
  await page.goBack();
  await expect(year).toHaveAttribute('data-value', '2025');
  await expect(buttons.first()).toHaveAttribute('aria-current', 'date');
  await page.setViewportSize({ width: 390, height: 844 });
  await selectOption(year, '2024');
  await expect(buttons).toHaveCount(12);
  await buttons.last().click();
  await expect(page).toHaveURL(/month=2024-01/);
  await expect(buttons.last()).toHaveAttribute('aria-current', 'date');
  await expect(page.getByText(tr('No income records this month'), { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('year-month-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
