import { selectOption } from './select.js';
import { expect, test } from '@playwright/test';
import { translate } from '../../src/i18n/index.js';

const tr = (key: string) => translate('zh', key);
test('edits prompts and models, persists credentials securely, and restores defaults on mobile', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/settings#classification');
  const initial = await (await page.request.get('/api/settings')).json();
  const prompt = page.getByLabel(tr('Transaction classification prompt'), { exact: true });
  const model = page.getByRole('combobox', { name: tr('Classification model'), exact: true });
  await expect(prompt).toHaveValue(initial.classificationPrompt);
  await model.click();
  await expect(page.getByRole('option').filter({ hasText: 'Fixture model' })).toBeVisible();
  await page.keyboard.press('Escape');
  await prompt.fill(initial.classificationPrompt + '\nTreat clearly identified daycare charges as childcare.');
  await selectOption(model, 'fixture-model');
  const classification = page.locator('#classification');
  await classification.getByRole('button', { name: tr('Save settings'), exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: tr('Settings saved. Future tasks will use the new configuration.') })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('classification-settings-desktop.png'), animations: 'disabled' });
  await page.reload();
  await expect(prompt).toContainText('daycare charges'); await expect(model).toHaveAttribute('data-value', 'fixture-model');
  await page.getByRole('navigation', { name: tr('Settings'), exact: true }).getByRole('link', { name: tr('Bank connections'), exact: true }).click();
  const secret = page.getByLabel(tr('Plaid secret'), { exact: true });
  await expect(secret).toHaveValue('');
  await secret.fill('synthetic-ui-secret');
  const response = page.waitForResponse((response) => response.url().endsWith('/api/settings') && response.request().method() === 'PUT');
  await page.locator('#bank-connections').getByRole('button', { name: tr('Save settings'), exact: true }).click();
  expect(await (await response).text()).not.toContain('synthetic-ui-secret');
  await expect(secret).toHaveValue('');
  await page.reload(); await expect(secret).toHaveAttribute('placeholder', tr('Saved — leave blank to keep it'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('navigation', { name: tr('Settings'), exact: true }).getByRole('link', { name: tr('Automatic classification'), exact: true }).click();
  await classification.getByRole('button', { name: tr('Restore default prompt'), exact: true }).click();
  await expect(prompt).toHaveValue(initial.defaultPrompt);
  await selectOption(model, initial.codexModel);
  await classification.getByRole('button', { name: tr('Save settings'), exact: true }).click();
  await expect(classification.getByRole('button', { name: tr('Save settings'), exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('classification-settings-mobile.png'), animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
  // Keep shared synthetic fixtures unchanged for the other browser scenarios.
  const current = await (await page.request.get('/api/settings')).json();
  expect((await page.request.put('/api/settings', { data: { revision: current.revision, plaidSecret: 'fixture' } })).ok()).toBe(true);
});

test('switches AI providers and retains independent models across saves and reloads', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/settings#classification');
  const initial = await (await page.request.get('/api/settings')).json();
  const provider = page.getByRole('combobox', { name: tr('Classification provider'), exact: true });
  const model = page.getByRole('combobox', { name: tr('Classification model'), exact: true });
  const save = page.locator('#classification').getByRole('button', { name: tr('Save settings'), exact: true });
  try {
    await selectOption(provider, 'claude');
    await selectOption(model, 'sonnet');
    await selectOption(provider, 'codex');
    await expect(model).toHaveAttribute('data-value', initial.codexModel);
    await selectOption(provider, 'claude');
    await expect(model).toHaveAttribute('data-value', 'sonnet');
    await save.click(); await expect(save).toBeDisabled();
    await page.reload();
    await expect(provider).toHaveAttribute('data-value', 'claude');
    await expect(model).toHaveAttribute('data-value', 'sonnet');
    await selectOption(model, '__manual_model__');
    await page.getByLabel(tr('Model ID'), { exact: true }).fill('fixture-claude-model');
    await save.click(); await expect(save).toBeDisabled();
    await page.reload(); await expect(model).toHaveAttribute('data-value', 'fixture-claude-model');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#classification').screenshot({ path: testInfo.outputPath('claude-settings-mobile.png'), animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await selectOption(provider, 'codex');
    await expect(model).toHaveAttribute('data-value', initial.codexModel);
    await save.click(); await expect(save).toBeDisabled();
    expect(errors).toEqual([]);
  } finally {
    const current = await (await page.request.get('/api/settings')).json();
    expect((await page.request.put('/api/settings', { data: { revision: current.revision, classificationProvider: initial.classificationProvider, claudeModel: initial.claudeModel } })).ok()).toBe(true);
  }
});
