import { test, expect, type Page } from '@playwright/test';
import { translate } from '../../src/i18n/index.js';
import type { WealthHistoryEntry, WealthSnapshot } from '../../src/shared/wealth.js';
import { selectOption } from './select.js';

const tr = (key: string, params?: Record<string, string | number>) => translate('zh', key, params);
const entries: WealthHistoryEntry[] = [
  { date: '2026-03-01', capturedAt: '2026-03-01T20:00:00Z', assetsCents: 8000000, debtsCents: 5400000, netWorthCents: 2600000, partial: false },
  { date: '2026-01-11', capturedAt: '2026-01-11T20:00:00Z', assetsCents: 5000000, debtsCents: 3000000, netWorthCents: 2000000, partial: false },
  { date: '2026-01-01', capturedAt: '2026-01-01T20:00:00Z', assetsCents: 1000000, debtsCents: 1100000, netWorthCents: -100000, partial: true },
];

async function history(page: Page, data: WealthHistoryEntry[]) {
  await page.route('**/api/wealth/history**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/wealth/history') return route.fulfill({ json: data });
    const entry = data.find(entry => path.endsWith(`/${entry.date}`));
    if (!entry) return route.fulfill({ status: 404, json: { error: 'Snapshot not found.' } });
    const snapshot: WealthSnapshot = { ...entry, usdCnyRate: 7, missingAccounts: entry.partial ? 1 : 0, accounts: [], assets: [], allocation: [], errors: [] };
    return route.fulfill({ json: snapshot });
  });
}

test('balance trend dates select the snapshot and stay synchronized with the date picker on desktop and phones', async ({ page }, testInfo) => {
  await history(page, entries);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/wealth/history');
    const picker = page.getByLabel(tr('Snapshot date (Pacific)'));
    await expect(picker).toHaveAttribute('data-value', '2026-03-01');
    const charts = page.locator('.balance-trend-chart');
    await expect(charts).toHaveCount(3);
    expect((await charts.last().boundingBox())!.y).toBeLessThan((await picker.boundingBox())!.y);
    for (const [index, metric] of ['Net worth', 'Total assets', 'Total debts'].entries()) {
      const chart = page.getByRole('group', { name: tr('{p0} trend', { p0: tr(metric) }) });
      const date = entries[index].date;
      await chart.getByRole('button', { name: new RegExp(`^${date}:`) }).click();
      await expect(picker).toHaveAttribute('data-value', date);
      await expect(page.locator('.balance-trend-point[aria-pressed="true"]')).toHaveCount(3);
      await expect(page.locator('.balance-trend-point[aria-pressed="true"]').first()).toHaveAttribute('data-date', date);
      await expect(page.locator('.wealth-history-totals')).toContainText(index === 0 ? '26,000' : index === 1 ? '20,000' : '1,000');
    }
    await expect(page.locator('.wealth-history .notice')).toContainText(tr('This snapshot contains missing balances, non-USD accounts or an incomplete update. Some values may be from an earlier refresh.'));
    await selectOption(picker, '2026-01-11');
    await expect(picker).toBeFocused();
    for (const chart of await charts.all()) await expect(chart.locator('[aria-pressed="true"]')).toHaveAttribute('data-date', '2026-01-11');
    await charts.first().locator('[aria-pressed="true"]').focus();
    await expect(charts.first().locator('[aria-pressed="true"]')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(picker).toHaveAttribute('data-value', '2026-03-01');
    await expect(charts.first().locator('[aria-pressed="true"]')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(picker).toHaveAttribute('data-value', '2026-01-01');
    const points = charts.first().locator('.balance-trend-dot');
    const positions = await points.evaluateAll(points => points.map(point => Number(point.getAttribute('cx'))));
    expect((positions[1] - positions[0]) / (positions[2] - positions[0])).toBeCloseTo(10 / 59);
    const axis = charts.first().locator('.balance-trend-date').last();
    await axis.click();
    await expect(picker).toHaveAttribute('data-value', '2026-03-01');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`balance-trends-${width}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});

test('balance trends handle empty history, a single zero snapshot, and a removed selected date', async ({ page }) => {
  let data: WealthHistoryEntry[] = [];
  await page.route('**/api/wealth/history', route => route.fulfill({ json: data }));
  await page.route('**/api/wealth/history/*', route => route.fulfill({ json: { ...data[0], usdCnyRate: 7, missingAccounts: 0, accounts: [], assets: [], allocation: [], errors: [] } }));
  await page.goto('/wealth/history');
  await expect(page.getByText(tr('No balance history yet. Update balances to save the first snapshot.'))).toBeVisible();
  await expect(page.locator('.balance-trend-chart')).toHaveCount(0);
  data = [{ ...entries[0], assetsCents: 0, debtsCents: 0, netWorthCents: 0 }];
  await page.reload();
  await expect(page.locator('.balance-trend-dot')).toHaveCount(3);
  for (const chart of await page.locator('.balance-trend-chart').all()) {
    await expect(chart.locator('.balance-trend-line')).not.toHaveAttribute('d', /NaN|Infinity/);
    await chart.getByRole('button').click();
  }
  const picker = page.getByLabel(tr('Snapshot date (Pacific)'));
  await expect(picker).toHaveAttribute('data-value', '2026-03-01');
  data = [{ ...data[0], date: '2026-03-02' }];
  await page.route('**/api/wealth/refresh', route => route.fulfill({ json: { refreshing: false } }));
  await page.getByRole('button', { name: tr('Update balances'), exact: true }).click();
  await expect(picker).toHaveAttribute('data-value', '2026-03-02');
});
