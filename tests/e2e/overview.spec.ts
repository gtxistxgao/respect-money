import { selectOption } from './select.js';
import { translate, shortMonth } from '../../src/i18n/index.js';
const tr = (key: string, params?: Record<string, string | number>) => translate('zh', key, params);
import { expect, test } from '@playwright/test';

test('compares monthly cash flow, selects categories and handles zero income on mobile', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const account = await (await request.post('/api/accounts/manual', { data: { name: 'Overview fixture card', institution: 'Test', type: 'credit', mask: '4321' } })).json();
  const emptyAccount = await (await request.post('/api/accounts/manual', { data: { name: 'Empty overview fixture', institution: 'Test', type: 'cash' } })).json();
  const add = async (month: string, amount: string, category: string, kind = 'expense') => {
    const response = await request.post('/api/transactions/manual', { data: { accountId: account.id, postedDate: `${month}-05`, description: `Overview ${category} ${month}`, amount, kind, category, country: 'US' } });
    expect(response.ok()).toBe(true);
  };
  for (const [month, income, dining, housing] of [['2026-03', '4000', '500', '1500'], ['2026-04', '4200', '700', '1500'], ['2026-05', '3800', '1100', '1700'], ['2026-06', '5000', '1000', '2000']]) {
    await add(month, income, 'salary', 'income'); await add(month, dining, 'dining'); await add(month, housing, 'housing');
  }
  await add('2026-06', '500', 'shopping');
  await add('2026-06', '500', 'dining', 'refund');
  await add('2026-07', '600', 'travel');
  await add('2026-08', '50', 'shopping', 'refund');
  const denseCategories = ['dining', 'groceries', 'housing', 'transport', 'shopping', 'health', 'childcare', 'entertainment', 'travel', 'side_business_expenses', 'investments', 'uncategorized'];
  for (const [index, category] of denseCategories.entries()) await add('2026-02', String((index + 1) * 10), category);
  const overview = await (await request.get(`/api/accounting/overview?accounts=${account.id}`)).json();
  const june = overview.months.find((month: { month: string }) => month.month === '2026-06');
  const summary = await (await request.get(`/api/accounting/summary?month=2026-06&accounts=${account.id}`)).json();
  expect(june).toEqual(summary);
  expect(june).toMatchObject({ incomeCents: 500000, expenseCents: 300000, spendingIncomeRatio: .6, grossExpenseCents: 350000 });

  await page.goto(`/overview?accounts=${account.id}&month=2026-06`);
  await expect(page.getByRole('heading', { name: tr('Overview'), exact: true })).toBeVisible();
  const monthNavigation = page.getByRole('navigation', { name: tr('Month navigation') });
  await expect(monthNavigation).toBeVisible();
  await expect(page.getByRole('combobox', { name: tr('Select year'), exact: true })).toHaveAttribute('data-value', '2026');
  const cashflow = page.getByRole('region', { name: tr("Selected month's cash flow") });
  await expect(cashflow).toContainText('60%');
  await expect(cashflow).toContainText('$5,000.00');
  const category = page.getByRole('region', { name: tr("Spending by category"), exact: true });
  await expect(category.getByRole('link', { name: new RegExp(tr("Housing")) })).toContainText('66.7%');
  await expect(category.getByRole('link', { name: new RegExp(tr('Dining')) })).toContainText('$500.00');
  await expect(category.getByRole('link', { name: new RegExp(tr('Dining')) })).toContainText('16.7%');
  const housingShare = category.getByRole('meter', { name: tr('Housing'), exact: true });
  await expect(housingShare).toHaveAttribute('aria-valuetext', '66.7%');
  expect(await housingShare.evaluate((element) => element.firstElementChild!.getBoundingClientRect().width / element.getBoundingClientRect().width)).toBeCloseTo(2000 / 3000, 2);
  await page.screenshot({ path: 'test-results/overview-desktop.png', fullPage: true, animations: 'disabled' });
  await page.goto(`/?accounts=${account.id}&month=2026-02`);
  await expect(category.getByRole('meter')).toHaveCount(denseCategories.length);
  const categoryGrid = category.getByRole('list');
  const gridLayout = await categoryGrid.evaluate((element) => ({
    columns: getComputedStyle(element).gridTemplateColumns.split(' ').length,
    height: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect([2, 3]).toContain(gridLayout.columns);
  expect(gridLayout.scrollHeight).toBe(gridLayout.height);
  const monthlySummary = page.getByRole('region', { name: tr('This month'), exact: true });
  expect(Math.abs((await monthlySummary.boundingBox())!.height - (await category.boundingBox())!.height)).toBeLessThan(2);
  await page.locator('.monthly-summary-row').screenshot({ path: 'test-results/category-shares-expanded.png', animations: 'disabled' });
  await page.goto(`/overview?accounts=${account.id}&month=2026-06`);
  await page.getByRole('button', { name: new RegExp("^" + tr("{p0}-{p1}", { p0: "2026", p1: "7" }) + "，") }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel(tr("View month"), { exact: true })).toHaveAttribute('data-value', '2026-07');
  await expect(cashflow).toContainText(tr("No confirmed income this month; ratio unavailable."));
  await expect(category.getByRole('link', { name: new RegExp(tr("Travel")) })).toContainText('100%');
  await selectOption(page.getByLabel(tr("View month"), { exact: true }), '2026-08');
  await expect(cashflow).toContainText('-$50.00');
  await expect(category.getByRole('link', { name: new RegExp(tr('Shopping')) })).toContainText('-$50.00');
  await expect(category).toContainText(tr('Net refund'));
  await expect(category.getByRole('meter', { name: tr('Shopping'), exact: true })).toHaveAttribute('aria-valuenow', '0');
  await page.getByRole('button', { name: new RegExp("^" + tr("{p0}-{p1}", { p0: "2026", p1: "6" }) + "，") }).click();
  await category.getByRole('link', { name: new RegExp(tr("Housing")) }).click();
  await expect(page).toHaveURL(/categories=housing/);
  await expect(page).toHaveURL(/mode=all/);
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('Overview housing 2026-06');
  await expect(page.getByRole('region', { name: tr("Spending by category"), exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: tr("Month navigation") }).getByRole('button', { name: new RegExp("^" + shortMonth("2026-07", "zh") + " ") }).click();
  await expect(page.getByRole('region', { name: tr("Spending by category"), exact: true }).getByRole('link', { name: new RegExp(tr("Travel")) })).toContainText('100%');

  await page.getByRole('link', { name: tr('Overview'), exact: true }).click();
  await expect(monthNavigation).toBeVisible();
  await expect(page.getByLabel(tr('View month'), { exact: true })).toHaveAttribute('data-value', '2026-07');
  await expect(page.getByLabel(tr('Filter overview accounts'))).toHaveAttribute('data-value', account.id);
  await selectOption(page.getByLabel(tr("Filter overview accounts")), account.id);
  await selectOption(page.getByLabel(tr("View month"), { exact: true }), '2026-06');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator('.trend-scroll').evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/overview-mobile.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await selectOption(page.getByRole('combobox', { name: tr('Select year'), exact: true }), '2024');
  await monthNavigation.getByRole('button', { name: new RegExp('^' + shortMonth('2024-02', 'zh') + ' ') }).click();
  await expect(page).toHaveURL(/\/overview\?.*month=2024-02/);
  await expect(page.getByLabel(tr('View month'), { exact: true })).toHaveAttribute('data-value', '2024-02');
  await expect(page.getByText(tr('No transactions have been received this month. This does not mean actual cash flow was zero.'), { exact: true })).toBeVisible();
  await page.getByRole('link', { name: tr('Accounting'), exact: true }).click();
  await expect(page).toHaveURL(/\/\?.*month=2024-02/);
  await expect(page.getByLabel(tr('Filter accounts'))).toHaveAttribute('data-value', account.id);
  await page.getByRole('button', { name: tr('Sync bank data'), exact: true }).click();
  await expect(page.getByLabel(tr('Synchronization month'))).toHaveValue('2024-02');
  await page.getByRole('button', { name: tr('Cancel'), exact: true }).click();
  await page.getByRole('link', { name: tr('Overview'), exact: true }).click();
  await expect(page.getByLabel(tr('View month'), { exact: true })).toHaveAttribute('data-value', '2024-02');
  await selectOption(page.getByLabel(tr("Filter overview accounts")), emptyAccount.id);
  await expect(page.getByRole('heading', { name: tr("Start a trend with your first record") })).toBeVisible();
  expect(errors).toEqual([]);
});
