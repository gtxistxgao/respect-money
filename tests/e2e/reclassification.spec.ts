import { expect, test } from '@playwright/test';
import { translate } from '../../src/i18n/index.js';
import { selectOption } from './select.js';

const tr = (key: string, params?: Record<string, string | number>) => translate('zh', key, params);

test('saves example rules, previews similar transfers and applies only checked categories on mobile', async ({ page, request }, testInfo) => {
  const account = await (await request.post('/api/accounts/manual', { data: { name: 'Pattern matching fixture', institution: 'Fixture', type: 'cash', mask: '4321' } })).json();
  const ids: string[] = [];
  for (const [description, amount] of [['Send to Alex Morgan REF A12345', '500'], ['SEND TO ALEX MORGAN REF B98765', '525'], ['Send to Jamie Morgan REF A12345', '500'], ['Send to Alex Morgan REF C65432', '800']]) {
    const response = await request.post('/api/transactions/manual', { data: { accountId: account.id, postedDate: '2026-01-12', description, amount, kind: 'expense', category: 'dining', country: 'JP', notes: 'Keep this note' } });
    expect(response.ok()).toBe(true); ids.push((await response.json()).id);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings#reclassification');
  const section = page.locator('#reclassification');
  await expect(section).toBeFocused();
  await section.getByLabel(tr('Transaction examples or pattern'), { exact: true }).fill('Send to Alex Morgan, about $500. Ignore reference IDs.');
  await selectOption(section.getByRole('combobox', { name: tr('Target category'), exact: true }), 'housing');
  await section.getByRole('button', { name: tr('Add rule'), exact: true }).click();
  const scan = section.getByRole('button', { name: tr('Scan existing transactions'), exact: true });
  await expect(scan).toHaveCount(1);
  await page.reload();
  await scan.click();
  const checkboxes = section.getByRole('checkbox');
  await expect(checkboxes).toHaveCount(2, { timeout: 10000 });
  await checkboxes.nth(1).uncheck();
  const remainingDescription = await checkboxes.nth(1).getAttribute('aria-label');
  await section.focus();
  await section.locator('.reclassification-preview').scrollIntoViewIfNeeded();
  await section.screenshot({ path: testInfo.outputPath('reclassification-mobile.png') });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await section.screenshot({ path: testInfo.outputPath('reclassification-narrow.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await section.screenshot({ path: testInfo.outputPath('reclassification-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await section.getByRole('button', { name: tr('Apply category to {count} transactions', { count: 1 }), exact: true }).click();
  await expect(section.getByRole('status')).toContainText(tr('Updated {count} transactions. These categories will be preserved during synchronization.', { count: 1 }));
  const details = await Promise.all(ids.map(async (id) => (await (await request.get(`/api/transactions/${id}`)).json()).transaction));
  expect(details.filter((row) => row.category === 'housing')).toHaveLength(1);
  expect(details.filter((row) => row.category === 'dining')).toHaveLength(3);
  expect(details.every((row) => row.notes === 'Keep this note' && row.country === 'JP')).toBe(true);
  expect(details[2].category).toBe('dining'); expect(details[3].category).toBe('dining');
  await scan.click();
  await expect(checkboxes).toHaveCount(1, { timeout: 10000 });
  await expect(checkboxes).toHaveAttribute('aria-label', remainingDescription!);
  await section.getByRole('button', { name: tr('Edit rule'), exact: true }).click();
  await expect(section.getByLabel(tr('Transaction examples or pattern'), { exact: true })).toHaveValue('Send to Alex Morgan, about $500. Ignore reference IDs.');
  await section.getByRole('button', { name: tr('Cancel'), exact: true }).click();
  await section.getByRole('button', { name: tr('Delete rule'), exact: true }).click();
  await expect(scan).toHaveCount(0);
});
