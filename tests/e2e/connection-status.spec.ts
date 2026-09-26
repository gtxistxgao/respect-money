import { test, expect } from '@playwright/test';
import { translate } from '../../src/i18n/index.js';

test('only expired authorization asks the user to reconnect', async ({ page }) => {
  await page.route('**/api/settings/status', async route => {
    const response = await route.fetch();
    const status = await response.json();
    await route.fulfill({ json: { ...status, connections: [
      { id: 'ready', institution: 'Ready Bank', products: ['transactions'], status: 'connected' },
      { id: 'pending', institution: 'Pending Bank', products: ['transactions'], status: 'error', lastError: 'Data is still being prepared.' },
      { id: 'expired', institution: 'Expired Bank', products: ['transactions'], status: 'login_required' },
    ] } });
  });
  await page.goto('/settings');
  const table = page.getByRole('table', { name: translate('zh', 'Bank connections'), exact: true });
  const pending = table.getByRole('row').filter({ hasText: 'Pending Bank' });
  await expect(pending).toContainText(translate('zh', 'Needs attention'));
  await expect(pending).toContainText('Data is still being prepared.');
  await expect(pending.getByRole('button', { name: translate('zh', 'Manage accounts at {p0}', { p0: 'Pending Bank' }) })).toBeVisible();
  await expect(pending).not.toContainText(translate('zh', 'Reconnect required'));
  const expired = table.getByRole('row').filter({ hasText: 'Expired Bank' });
  await expect(expired).toContainText(translate('zh', 'Reconnect required'));
  await expect(expired.getByRole('button', { name: translate('zh', 'Reconnect {p0}', { p0: 'Expired Bank' }) })).toBeVisible();
  await expect(table.getByRole('row').filter({ hasText: 'Ready Bank' })).toContainText(translate('zh', 'Connected'));
});
