import { test, expect } from '@playwright/test';
import { translate } from '../../src/i18n/index.js';
import type { Account } from '../../src/shared/models.js';
import type { SettingsStatus } from '../../src/web/api.js';

const tr = (key: string, params?: Record<string, string | number>) => translate('zh', key, params);
test('disconnect confirmation supports cancellation and retry, preserves history and removes the account from sync', async ({ page, request }, testInfo) => {
  const connect = async () => {
    const session = await (await request.post('/api/plaid/link-token', { data: {} })).json();
    expect((await request.post('/api/plaid/complete', { data: { sessionId: session.sessionId, publicToken: 'fixture-bank-public', institution: 'Chase' } })).ok()).toBe(true);
  };
  const status: SettingsStatus = await (await request.get('/api/settings/status')).json();
  if (!status.connections.some(c => c.id === 'bank-item')) await connect();
  const accounts: Account[] = await (await request.get('/api/accounts')).json();
  const bank = accounts.find(a => a.itemId === 'bank-item')!;
  const job = await (await request.post('/api/jobs', { data: { accountIds: [bank.id], range: { start: '2026-08-01', end: '2026-08-31' } } })).json();
  await expect.poll(async () => (await (await request.get('/api/jobs')).json()).find((row: { id: string }) => row.id === job.id)?.status).toBe('succeeded');
  const ledgerUrl = `/api/accounting/transactions?month=2026-08&accounts=${bank.id}&mode=all`;
  const before = await (await request.get(ledgerUrl)).json();
  await request.post('/api/wealth/refresh');
  await expect.poll(async () => (await (await request.get('/api/wealth')).json()).refreshing).toBe(false);
  const history = await (await request.get('/api/wealth/history')).json();
  let release = () => {};
  try {
    await page.goto('/settings#bank-connections');
    const connections = page.getByRole('table', { name: tr('Bank connections'), exact: true });
    const disconnect = connections.getByRole('button', { name: tr('Disconnect {p0}', { p0: 'Chase' }), exact: true });
    await page.locator('#bank-connections').screenshot({ path: testInfo.outputPath('disconnect-desktop.png'), animations: 'disabled' });
    await disconnect.click();
    const dialog = page.getByRole('dialog', { name: tr('Disconnect {p0}', { p0: 'Chase' }) });
    await dialog.getByRole('button', { name: tr('Cancel'), exact: true }).click();
    await expect(dialog).toHaveCount(0); await expect(disconnect).toBeVisible();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 }); await disconnect.click();
      await expect(dialog).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`disconnect-${width}.png`), animations: 'disabled' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
    }
    await disconnect.click();
    await page.route('**/api/plaid/connections/bank-item', route => route.fulfill({ status: 502, json: { error: 'Temporary provider failure' } }));
    await dialog.getByRole('button', { name: tr('Disconnect'), exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Temporary provider failure');
    expect((await (await request.get('/api/settings/status')).json()).connections.some((c: { id: string }) => c.id === 'bank-item')).toBe(true);
    await page.unroute('**/api/plaid/connections/bank-item');
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/plaid/connections/bank-item', async route => { await gate; await route.continue(); });
    await dialog.getByRole('button', { name: tr('Disconnect'), exact: true }).click();
    await expect(dialog.getByRole('button', { name: tr('Disconnecting…') })).toBeDisabled();
    await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
    release(); await expect(dialog).toHaveCount(0);
    await expect(disconnect).toHaveCount(0);
    const row = page.getByRole('table', { name: tr('My accounts'), exact: true }).getByRole('row').filter({ hasText: bank.name });
    await expect(row).toContainText(tr('Disconnected'));
    expect(await (await request.get(ledgerUrl)).json()).toEqual(before);
    expect(await (await request.get('/api/wealth/history')).json()).toEqual(history);
    expect((await (await request.get('/api/wealth')).json()).accounts.some((a: { id: string }) => a.id === bank.id)).toBe(false);
    await page.reload(); await expect(row).toContainText(tr('Disconnected'));
    await page.goto('/?month=2026-08');
    await page.getByRole('button', { name: tr('Sync bank data'), exact: true }).click();
    await page.getByRole('combobox', { name: tr('Accounts to update') }).click();
    await expect(page.getByRole('option', { name: `${bank.name} · ${bank.mask}`, exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: tr('Reclassify'), exact: true }).click();
    await page.getByRole('combobox', { name: tr('Accounts to update') }).click();
    await expect(page.getByRole('option', { name: `${bank.name} · ${bank.mask}`, exact: true })).toBeVisible();
  } finally { release(); await connect(); }
});
