import { expect, test } from '@playwright/test';
import { translate } from '../../src/i18n/index.js';

const tr = (key: string) => translate('zh', key);
test.use({ timezoneId: 'Asia/Shanghai' });

for (const scenario of [
  { instant: '2026-09-14T06:00:00Z', month: '2026-09', end: '2026-09-13' },
  { instant: '2026-01-01T07:00:00Z', month: '2025-12', end: '2025-12-31' },
]) {
  test(`submits Pacific dates from Shanghai at ${scenario.instant}`, async ({ page }) => {
    await page.clock.setFixedTime(new Date(scenario.instant));
    await page.route('**/api/accounts', (route) => route.fulfill({ json: [{
      id: 'fixture-bank', name: 'Fixture bank', institution: 'Fixture', type: 'depository', source: 'plaid', enabled: true,
    }] }));
    await page.route('**/api/jobs', (route) => route.request().method() === 'POST' ? route.fulfill({ status: 202, json: {} }) : route.continue());
    await page.goto('/');
    await page.getByRole('button', { name: tr('Sync bank data'), exact: true }).click();
    const dialog = page.getByRole('dialog');
    const month = dialog.getByLabel(tr('Synchronization month'));
    await expect(month).toHaveValue(scenario.month);
    await expect(month).toHaveAttribute('max', scenario.month);
    await dialog.getByRole('button', { name: tr('Reclassify'), exact: true }).click();
    await dialog.getByLabel(tr('Reanalyze automatic classifications, preserving manual edits')).check();
    await dialog.getByRole('button', { name: tr('Sync bank data'), exact: true }).click();
    await expect(dialog.getByLabel(tr('Reanalyze automatic classifications, preserving manual edits'))).toHaveCount(0);
    const submitted = page.waitForRequest((request) => request.url().endsWith('/api/jobs') && request.method() === 'POST');
    await dialog.getByRole('button', { name: tr('Start synchronization'), exact: true }).click();
    expect((await submitted).postDataJSON()).toMatchObject({ type: 'sync', range: { start: `${scenario.month}-01`, end: scenario.end }, force: false });
    await expect(dialog).toHaveCount(0);
  });
}
