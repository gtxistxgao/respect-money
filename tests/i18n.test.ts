import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { catalogs, message, renderMessage, resolveLocale, translate } from '../src/i18n/index.js';
import { localizeResponse } from '../src/server/localization.js';
import { buildApp } from '../src/server/app.js';
import { readConfig } from '../src/server/config.js';
import { Repository } from '../src/server/storage/repository.js';
import { fakePlaid } from './fixtures/plaid.js';
import { PlaidFailure } from '../src/server/integrations/plaid/client.js';

it('keeps catalog keys and interpolation parameters aligned and non-English text out of executable source', async () => {
  expect(Object.keys(catalogs.zh).sort()).toEqual(Object.keys(catalogs.en).sort());
  const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const [key, value] of Object.entries(catalogs.en)) {
    expect(catalogs.zh[key].trim()).not.toBe('');
    expect(placeholders(catalogs.zh[key]), key).toEqual(placeholders(value));
  }
  async function scan(root: string) {
    for (const item of await readdir(root, { withFileTypes: true })) {
      const path = join(root, item.name);
      if (item.isDirectory()) await scan(path);
      else if (/\.[cm]?[jt]sx?$/.test(item.name)) expect(await readFile(path, 'utf8'), path).not.toMatch(/\p{Script=Han}/u);
    }
  }
  await scan('src'); await scan('scripts'); await scan('tests');
});

it('negotiates languages without global request state and renders nested and historical messages', () => {
  expect(resolveLocale('en-US,en;q=0.9,zh;q=0.5')).toBe('en');
  expect(resolveLocale('fr;q=1,zh-CN;q=0.8,en;q=0.2')).toBe('zh');
  expect(resolveLocale('zh;q=0,en;q=0.5')).toBe('en');
  expect(resolveLocale('fr')).toBe('en');
  const key = 'Reading {p0}…';
  expect(renderMessage(message(key, { p0: 'Test Bank' }), 'zh')).toBe(translate('zh', key, { p0: 'Test Bank' }));
  expect(renderMessage(translate('zh', key, { p0: 'Test Bank' }), 'en')).toBe('Reading Test Bank…');
  const nested = message('{p0}: {p1}', { p0: 'Test Bank', p1: message('Invalid Plaid credentials. Check the environment and keys.') });
  const oldNested = translate('zh', '{p0}: {p1}', { p0: 'Test Bank', p1: translate('zh', 'Invalid Plaid credentials. Check the environment and keys.') });
  expect(renderMessage(oldNested, 'en')).toBe('Test Bank: Invalid Plaid credentials. Check the environment and keys.');
  expect(renderMessage(nested, 'en')).toBe('Test Bank: Invalid Plaid credentials. Check the environment and keys.');
  expect(renderMessage(message('Reading {p0}…', { p0: '{p1} $&' }), 'en')).toBe('Reading {p1} $&…');
  const userText = translate('zh', 'Ledger updated.');
  expect(localizeResponse({ name: userText, description: userText, notes: userText, message: userText, raw: { message: userText } }, 'en')).toEqual({ name: userText, description: userText, notes: userText, message: 'Ledger updated.', raw: { message: userText } });
});

it('returns localized validation, Plaid errors and persisted job messages while preserving financial data', async () => {
  const path = await mkdtemp(join(tmpdir(), 'respect-money-i18n-'));
  const repository = await new Repository(path).initialize();
  const originalName = translate('zh', 'Shopping');
  const account = await repository.addAccount({ name: originalName, institution: 'Fixture Bank', mask: '1234', type: 'cash' });
  await repository.change((state) => {
    state.jobs.fixture = { id: 'fixture', type: 'sync', status: 'succeeded', accountIds: [account.id], range: { start: '2026-01-01', end: '2026-08-01' }, force: false, refresh: false, createdAt: '2026-08-01', updatedAt: '2026-08-01', progress: 1, total: 1, message: message('Ledger updated.'), errors: [translate('zh', 'The bank is still preparing data. Please try again later.')] };
  }, false);
  await repository.close();
  const plaid = fakePlaid(); plaid.createLink = async () => { throw new PlaidFailure('INVALID_API_KEYS'); };
  const app = await buildApp({ ...readConfig(), dataDir: path }, { plaid });
  try {
    for (const locale of ['en', 'zh'] as const) {
      const headers = { 'accept-language': locale };
      const error = await app.inject({ method: 'GET', url: '/api/transactions/missing', headers });
      expect(error.statusCode).toBe(404); expect(error.headers['content-language']).toBe(locale);
      expect(error.json().error).toBe(translate(locale, 'Transaction not found.'));
      const invalid = await app.inject({ method: 'POST', url: '/api/jobs', headers, payload: { type: 'sync', range: { start: '2026-08-01', end: '2026-01-01' } } });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json().error).toContain(translate(locale, 'The start date cannot be after the end date'));
      const failedLink = await app.inject({ method: 'POST', url: '/api/plaid/link-token', headers, payload: { product: 'transactions' } });
      expect(failedLink.statusCode).toBe(502);
      expect(failedLink.json().error).toBe(translate(locale, 'Invalid Plaid credentials. Check the environment and keys.'));
      const status = (await app.inject({ url: '/api/settings/status', headers })).json();
      expect(status.jobs[0].message).toBe(translate(locale, 'Ledger updated.'));
      expect(status.jobs[0].errors[0]).toBe(translate(locale, 'The bank is still preparing data. Please try again later.'));
      expect((await app.inject({ url: '/api/accounts', headers })).json()[0].name).toBe(originalName);
    }
    const concurrent = await Promise.all(['zh', 'en', 'zh', 'en'].map((locale) => app.inject({ url: '/api/transactions/missing', headers: { 'accept-language': locale } })));
    concurrent.forEach((response, index) => expect(response.json().error).toBe(translate(index % 2 ? 'en' : 'zh', 'Transaction not found.')));
  } finally { await app.close(); await rm(path, { recursive: true, force: true }); }
});
