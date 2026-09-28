import { expect, test } from '@playwright/test';
import { translate } from '../../src/i18n/index.js';

const tr = (key: string) => translate('zh', key);
test('configures a currency and rate, toggles all conversions, and preserves USD totals on desktop and mobile', async ({ page, request }, testInfo) => {
  const initial = await (await request.get('/api/settings')).json();
  const assetResponse = await request.post('/api/wealth/assets', { data: { name: 'Currency fixture', kind: 'cash', valueCents: 100000, debtCents: 25000, valuationDate: '2026-01-01' } });
  expect(assetResponse.ok()).toBe(true);
  const asset = await assetResponse.json();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const card = page.locator('#currency');
  const toggle = card.getByRole('switch', { name: tr('Enable currency conversion') });
  const currency = card.getByLabel(tr('Currency code'), { exact: true });
  const rate = card.getByLabel(tr('Exchange rate per 1 USD'), { exact: true });
  const save = card.getByRole('button', { name: tr('Save settings'), exact: true });
  try {
    await page.goto('/settings#currency');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(currency).toHaveValue('CNY');
    await currency.fill('cad'); await rate.fill('1.4');
    await save.click(); await expect(save).toBeDisabled(); await page.reload();
    await expect(currency).toHaveValue('CAD'); await expect(rate).toHaveValue('1.4');
    await card.screenshot({ path: testInfo.outputPath('exchange-rate-desktop.png') });
    await page.goto('/wealth');
    const usdTotal = await page.getByTestId('net-worth').innerText();
    await expect(page.getByTestId('net-worth-converted')).toContainText('CAD');
    const manual = page.getByRole('article', { name: 'Currency fixture', exact: true });
    await expect(manual.locator('.wealth-converted')).toHaveText(['\u7ea6 1,400 CAD', '\u7ea6 350 CAD', '\u7ea6 1,050 CAD']);
    await page.getByRole('button', { name: tr('Net worth details'), exact: true }).click();
    await expect(page.getByRole('dialog').locator('.wealth-converted')).toContainText('CAD');
    await page.keyboard.press('Escape');
    await page.goto('/settings#currency'); await toggle.click(); await expect(currency).toBeDisabled(); await expect(rate).toBeDisabled();
    await save.click(); await expect(save).toBeDisabled(); await page.reload();
    await expect(toggle).toHaveAttribute('aria-checked', 'false'); await expect(currency).toHaveValue('CAD'); await expect(rate).toHaveValue('1.4');
    await page.goto('/wealth');
    await expect(page.locator('.wealth-converted')).toHaveCount(0); await expect(page.getByTestId('net-worth')).toHaveText(usdTotal);
    await expect(page.locator('.wealth-context a[href="/settings#currency"]')).toHaveCount(0);
    await page.getByRole('button', { name: tr('Net worth details'), exact: true }).click();
    await expect(page.getByRole('dialog').locator('.wealth-converted')).toHaveCount(0); await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/settings#currency'); await toggle.focus(); await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-checked', 'true'); await currency.fill('EUR'); await rate.fill('0.9');
    await save.click(); await expect(save).toBeDisabled();
    await card.screenshot({ path: testInfo.outputPath('exchange-rate-mobile.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.goto('/wealth');
    await expect(manual.locator('.wealth-converted')).toHaveText(['\u7ea6 900 EUR', '\u7ea6 225 EUR', '\u7ea6 675 EUR']);
    await expect(page.getByTestId('net-worth')).toHaveText(usdTotal);
    expect(errors).toEqual([]);
  } finally {
    const current = await (await request.get('/api/settings')).json();
    expect((await request.put('/api/settings', { data: { revision: current.revision, displayConversion: initial.displayConversion } })).ok()).toBe(true);
    expect((await request.delete(`/api/wealth/assets/${asset.id}`, { data: { revision: asset.revision } })).ok()).toBe(true);
  }
});
