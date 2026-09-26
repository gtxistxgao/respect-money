import { SqliteStore, DATABASE_NAME } from '../src/server/storage/sqlite-store.js';
import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../src/server/app.js';
import { readConfig } from '../src/server/config.js';
import { integrationPlaid, integrationClassifier } from './fixtures/integration.js';
import { PlaidFailure } from '../src/server/integrations/plaid/client.js';

it('completes available accounts during partial failure and retains tokens and overrides across restart', async () => {
  const path = await mkdtemp(join(tmpdir(), 'respect-money-pipeline-'));
  const plaid = integrationPlaid();
  const config = { ...readConfig(), dataDir: path };
  const dependencies = { plaid, classifyBatch: integrationClassifier, polling: { attempts: 1, delayMs: 0 } };
  let app = await buildApp(config, dependencies);
  try {
    for (const product of ['transactions', 'investments']) {
      const link = (await app.inject({ method: 'POST', url: '/api/plaid/link-token', payload: { product } })).json();
      expect((await app.inject({ method: 'POST', url: '/api/plaid/complete', payload: { sessionId: link.sessionId, publicToken: product === 'transactions' ? 'fixture-bank-public' : 'fixture-invest-public', institution: product === 'transactions' ? 'Chase' : 'Fidelity' } })).statusCode).toBe(200);
    }
    const original = plaid.investments; plaid.investments = async () => { throw new PlaidFailure('ITEM_LOGIN_REQUIRED'); };
    const started = (await app.inject({ method: 'POST', url: '/api/jobs', payload: { type: 'sync', range: { start: '2026-01-01', end: '2026-08-31' } } })).json();
    await expect.poll(async () => (await app.inject('/api/jobs')).json().find((job: { id: string }) => job.id === started.id).status).toBe('partial_failed');
    expect((await app.inject('/api/accounting/summary?month=2026-08')).json()).toMatchObject({ incomeCents: 500000, expenseCents: 10000 });
    const tx = (await app.inject('/api/accounting/transactions?month=2026-08')).json().rows[0];
    await app.inject({ method: 'PUT', url: `/api/transactions/${tx.id}/overrides`, payload: { version: tx.version, country: 'CN' } });
    await app.close(); app = await buildApp(config, dependencies);
    expect((await app.inject('/api/accounting/transactions?month=2026-08')).json().rows[0].country).toBe('CN');
    plaid.investments = original;
    const retry = (await app.inject({ method: 'POST', url: `/api/jobs/${started.id}/retry` })).json();
    await expect.poll(async () => (await app.inject('/api/jobs')).json().find((job: { id: string }) => job.id === retry.id).status).toBe('succeeded');
    expect((await app.inject('/api/accounting/summary?month=2026-08')).json()).toMatchObject({ incomeCents: 505000, expenseCents: 10000 });
    const status = await app.inject('/api/settings/status');
    expect(status.body).not.toContain('fixture-bank-token'); expect(status.body).not.toContain('fixture-invest-token');
    const stored = SqliteStore.open(join(path, DATABASE_NAME), true);
    try { expect(Object.values(stored.load().vault.tokens)).toContain('fixture-bank-token'); } finally { stored.close(); }
    expect((await app.inject('/data/respect-money.sqlite')).body).not.toContain('fixture-bank-token');
    const hidden = await app.inject('/data/private/plaid.json'); expect(hidden.body).not.toContain('fixture-bank-token');
  } finally { await app.close(); await rm(path, { recursive: true, force: true }); }
});
