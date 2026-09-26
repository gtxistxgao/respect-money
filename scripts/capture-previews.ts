import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect, type Browser } from '@playwright/test';
import { buildApp } from '../src/server/app.js';
import { defaultSettings } from '../src/server/config.js';
import { integrationPlaid, integrationClassifier, integrationPatternMatcher } from '../tests/fixtures/integration.js';

// Never load readConfig() or the owner's data directory. All figures and names
// below are invented; Plaid and AI calls use in-process test doubles.
const dataDir = await mkdtemp(join(tmpdir(), 'respect-money-preview-'));
const output = resolve('docs/assets/screenshots');
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
let browser: Browser | undefined;
try {
  app = await buildApp({ ...defaultSettings(), dataDir, port: 4191, codexBin: 'preview-codex-disabled' }, {
    plaid: integrationPlaid(), classifyBatch: integrationClassifier,
    matchPatterns: integrationPatternMatcher, models: async () => [],
  });
  async function post(url: string, payload: Record<string, unknown>) {
    const response = await app!.inject({ method: 'POST', url, payload, headers: { 'accept-language': 'en' } });
    if (response.statusCode >= 400) throw new Error(`${url}: ${response.body}`);
    return response.json();
  }
  const account = await post('/api/accounts/manual', { name: 'Sample checking', institution: 'Example Bank', type: 'cash', mask: '0001' });
  for (let month = 3; month <= 8; month++) {
    const prefix = `2026-${String(month).padStart(2, '0')}`;
    const entries = [
      ['01', 'Example company payroll', 6200 + month * 25, 'income', 'salary'],
      ['02', 'Apartment rent', 1760, 'expense', 'housing'],
      ['05', 'Neighborhood market', 420 + month * 17, 'expense', 'groceries'],
      ['08', 'Corner cafe', 85 + month * 8, 'expense', 'dining'],
      ['12', 'Weekend train tickets', 80 + month * 10, 'expense', 'travel'],
      ['15', 'Home supplies', 180 + month * 12, 'expense', 'shopping'],
      ['18', 'Internet and electricity', 165, 'expense', 'housing'],
    ];
    for (const [day, description, amount, kind, category] of entries) {
      await post('/api/transactions/manual', { accountId: account.id, postedDate: `${prefix}-${day}`, description, amount: String(amount), kind, category, country: 'US' });
    }
  }
  for (const [day, description, amount] of [['20', 'Send to Alex Morgan REF A12345', '500'], ['22', 'SEND TO ALEX MORGAN REF B98765', '525']]) {
    await post('/api/transactions/manual', { accountId: account.id, postedDate: `2026-08-${day}`, description, amount, kind: 'expense', category: 'dining', country: 'US' });
  }
  for (const asset of [
    { name: 'Sample emergency fund', kind: 'cash', valueCents: 1250000, debtCents: 0 },
    { name: 'Sample index funds', kind: 'funds', valueCents: 7500000, debtCents: 0 },
    { name: 'Sample home', kind: 'property', valueCents: 65000000, debtCents: 39000000 },
    { name: 'Sample car', kind: 'vehicle', valueCents: 2500000, debtCents: 500000, vehicleModel: 'Example family car' },
  ]) await post('/api/wealth/assets', { ...asset, valuationDate: '2026-01-01' });
  const rule = await post('/api/reclassification/rules', { example: 'Send to Alex Morgan, about $500. Ignore reference IDs.', category: 'housing', direction: 'outgoing' });
  const preview = await post(`/api/reclassification/rules/${rule.id}/preview`, {});
  await expect.poll(async () => (await app!.inject(`/api/reclassification/previews/${preview.id}`)).json().status).toBe('ready');

  const address = await app.listen({ host: '127.0.0.1', port: 4191 });
  await mkdir(output, { recursive: true });
  browser = await chromium.launch();
  const context = await browser.newContext({ locale: 'en-US', timezoneId: 'America/Los_Angeles', reducedMotion: 'reduce', deviceScaleFactor: 1 });
  // This is a new, disposable browser context, unrelated to the user's session.
  await context.addInitScript(() => localStorage.setItem('respect-money-language', 'en'));
  await context.route('**/*', (route) => new URL(route.request().url()).origin === address ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') console.error(message.text()); });
  page.on('requestfailed', (request) => console.error(request.url(), request.failure()));
  for (const [size, width, height] of [['desktop', 1440, 1050], ['mobile', 390, 844]] as const) {
    await page.setViewportSize({ width, height });
    for (const [name, path, ready] of [
      ['overview', '/overview?month=2026-08&period=all', '.cashflow-totals'],
      ['ledger', '/?month=2026-08', 'tbody tr'],
      ['wealth', '/wealth', '[data-testid="net-worth"]'],
      ['rules', '/settings#reclassification', '.reclassification-matches'],
    ]) {
      await page.goto(`${address}${path}`);
      await expect(page.locator(ready).first()).toBeVisible().catch(async (error: unknown) => {
        console.error(errors, await page.locator('body').innerText());
        throw error;
      });
      await page.evaluate(() => document.fonts.ready);
      if (name === 'rules') {
        await expect(page.locator('#reclassification')).toBeFocused();
        await expect(page.getByRole('checkbox')).toHaveCount(2);
        // Capture the actual Settings section, including the complete match review.
        await page.locator('#reclassification').screenshot({ path: join(output, `${name}-${size}.png`), animations: 'disabled' });
      } else {
        await page.screenshot({ path: join(output, `${name}-${size}.png`), animations: 'disabled', fullPage: true });
      }
      console.log(`Captured ${name}-${size}.png`);
    }
  }
  expect(errors).toEqual([]);
} finally {
  await browser?.close();
  await app?.close();
  await rm(dataDir, { recursive: true, force: true });
}
