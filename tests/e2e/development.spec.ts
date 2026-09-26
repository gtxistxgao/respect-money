import { translate } from '../../src/i18n/index.js';
const tr = (key: string, params?: Record<string, string | number>) => translate('zh', key, params);
import { test, expect } from '@playwright/test';

test('development modules load and API requests reach the backend', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  // The API proxy must not intercept the frontend's similarly named api.ts module.
  const module = await request.get('/api.ts');
  expect(module.ok()).toBe(true);
  expect(module.headers()['content-type']).toContain('javascript');
  const health = await request.get('/api/health');
  expect(health.ok()).toBe(true);
  expect(await health.json()).toEqual({ ok: true, name: 'Respect Money' });

  await page.goto('/');
  await expect(page.getByRole('button', { name: tr("Add transaction") })).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(tr("Total spending")) })).toBeVisible();
  await page.getByRole('link', { name: tr("Settings"), exact: true }).click();
  await expect(page.getByRole('heading', { name: tr("Bank connections") })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: tr("My accounts") })).toBeVisible();
  await page.getByRole('link', { name: tr("Back to ledger") }).click();
  await expect(page.getByRole('button', { name: new RegExp(tr("Total income")) })).toBeVisible();
  expect(errors).toEqual([]);
});
