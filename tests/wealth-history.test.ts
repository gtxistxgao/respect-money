import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { AccountBase } from 'plaid';
import { Repository } from '../src/server/storage/repository.js';
import { WealthService } from '../src/server/services/wealth.js';
import { reconcileAccounts } from '../src/server/services/connections.js';
import { emptyWealth } from '../src/shared/wealth.js';
import { defaultSettings, readConfig } from '../src/server/config.js';
import { buildApp } from '../src/server/app.js';
import { PlaidFailure } from '../src/server/integrations/plaid/client.js';
import { fakePlaid, bankAccount } from './fixtures/plaid.js';
import { createBackup, restoreBackup } from '../src/server/storage/backups.js';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'respect-money-history-'));
  const repo = await new Repository(dir).initialize();
  let value = 1000; let fail = false;
  const plaid = fakePlaid({ accounts: async () => {
    if (fail) throw new PlaidFailure('INSTITUTION_DOWN');
    return { item: { item_id: 'item' }, accounts: [{ ...bankAccount, balances: { current: value, iso_currency_code: 'USD' } }], request_id: 'fixture' } as Awaited<ReturnType<ReturnType<typeof fakePlaid>['accounts']>>;
  } });
  await repo.change((state) => {
    state.connections.item = { id: 'item', institution: 'Fixture', products: ['transactions'], status: 'connected' };
    state.vault.tokens.item = 'synthetic-token'; state.settings = defaultSettings();
    state.wealth = emptyWealth();
    state.wealth.assets.push({ id: 'car', revision: 0, name: 'Fixture car', kind: 'vehicle', valueCents: 100000, debtCents: 20000, address: '', vehicleModel: 'Fixture model', valuationDate: '2026-01-01', debtAccountId: null });
    reconcileAccounts(state, 'item', [bankAccount]);
  }, false);
  const service = new WealthService(repo, plaid);
  return { dir, repo, service, plaid, setValue: (next: number) => { value = next; }, setFailure: (next: boolean) => { fail = next; }, refresh: async () => { service.refresh(); await service.close(); }, close: async () => { await service.close(); await repo.close(); await rm(dir, { recursive: true, force: true }); } };
}

it('saves one snapshot per Pacific date, freezes prior values and survives restart and backup restore', async () => {
  const f = await fixture();
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date('2026-09-22T06:59:00Z'));
    await f.refresh();
    expect(f.service.history().map((row) => row.date)).toEqual(['2026-09-21']);
    expect(f.service.historical('2026-09-21')).toMatchObject({ assetsCents: 200000, debtsCents: 20000, netWorthCents: 180000, usdCnyRate: 6.7, partial: false });
    f.setValue(1200); await f.refresh();
    expect(f.service.history()).toHaveLength(1);
    const previous = f.service.historical('2026-09-21');
    expect(previous.accounts[0].balance?.netCents).toBe(120000);
    expect(previous.accounts[0].fresh).toBe(true);
    vi.setSystemTime(new Date('2026-09-22T07:01:00Z'));
    await f.repo.change((state) => { state.settings!.usdCnyRate = 7; state.wealth!.assets[0].valueCents = 150000; state.accounts[0].name = 'Renamed fixture'; }, false);
    f.setValue(1400); await f.refresh();
    expect(f.service.history().map((row) => row.date)).toEqual(['2026-09-22', '2026-09-21']);
    expect(f.service.historical('2026-09-21')).toEqual(previous);
    expect(f.service.historical('2026-09-22')).toMatchObject({ netWorthCents: 270000, usdCnyRate: 7 });
    expect(f.service.historical('2026-09-22').accounts[0].name).toBe('Renamed fixture');
    await f.repo.close();
    const backup = await createBackup(f.dir);
    const reloaded = await new Repository(f.dir).initialize();
    expect(reloaded.snapshot().wealth?.history?.['2026-09-21']).toEqual(previous);
    await reloaded.change((state) => { state.wealth!.history = {}; }, false); await reloaded.close();
    await restoreBackup(f.dir, backup);
    const app = await buildApp(readConfig(f.dir), { plaid: f.plaid });
    try {
      const list = (await app.inject('/api/wealth/history')).json();
      expect(list).toHaveLength(2); expect(list[0].accounts).toBeUndefined();
      expect((await app.inject('/api/wealth/history/2026-09-21')).json()).toEqual(previous);
      expect((await app.inject('/api/wealth/history/2026-09-20')).statusCode).toBe(404);
      expect((await app.inject('/api/wealth/history/2026-02-30')).statusCode).toBe(400);
      expect(JSON.stringify(list)).not.toContain('synthetic-token');
    } finally { await app.close(); }
  } finally { vi.useRealTimers(); await f.close(); }
});

it('keeps the last successful snapshot on total failure and labels stale data in partial updates', async () => {
  const f = await fixture();
  try {
    await f.refresh(); const previous = f.service.historical(f.service.history()[0].date);
    f.setFailure(true); await f.refresh();
    expect(f.service.historical(previous.date)).toEqual(previous);
    const other = { ...bankAccount, account_id: 'other-account', name: 'Other fixture', balances: { current: 500, iso_currency_code: 'USD' } } as AccountBase;
    await f.repo.change((state) => {
      state.connections.other = { id: 'other', institution: 'Other fixture', products: ['transactions'], status: 'connected' };
      state.vault.tokens.other = 'other-fixture-token'; reconcileAccounts(state, 'other', [other]);
    }, false);
    const original = f.plaid.accounts;
    f.plaid.accounts = async (token) => token === 'other-fixture-token' ? { item: { item_id: 'other' }, accounts: [other], request_id: 'fixture' } as Awaited<ReturnType<typeof original>> : original(token);
    await f.refresh();
    const partial = f.service.historical(previous.date);
    expect(partial.partial).toBe(true); expect(partial.errors).toHaveLength(1);
    expect(partial.accounts[0]).toMatchObject({ fresh: false, balance: previous.accounts[0].balance });
    expect(partial.accounts[1]).toMatchObject({ fresh: true, balance: { netCents: 50000 } });
    expect(partial.netWorthCents).toBe(230000);
  } finally { await f.close(); }
});

it('records manual-only assets, including a later zero balance, without fabricating earlier dates', async () => {
  const f = await fixture();
  try {
    await f.repo.change((state) => { state.connections = {}; state.vault.tokens = {}; state.accounts = []; }, false);
    expect(f.service.history()).toEqual([]);
    await f.refresh();
    const date = f.service.history()[0].date;
    expect(f.service.historical(date)).toMatchObject({ accounts: [], netWorthCents: 80000 });
    await f.repo.change((state) => { state.wealth!.assets = []; }, false); await f.refresh();
    expect(f.service.historical(date)).toMatchObject({ accounts: [], assets: [], netWorthCents: 0 });
    expect(f.service.history()).toHaveLength(1);
  } finally { await f.close(); }
});

it('captures each snapshot currency and toggle without rewriting prior snapshots or USD balances', async () => {
  const f = await fixture();
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date('2026-09-20T18:00:00Z'));
    await f.refresh();
    // Simulate a snapshot written before currency selection existed.
    await f.repo.change(state => { delete state.wealth!.history!['2026-09-20'].displayConversion; }, false);
    const legacy = f.service.historical('2026-09-20');
    vi.setSystemTime(new Date('2026-09-21T18:00:00Z'));
    await f.repo.change(state => { state.settings!.displayConversion = { enabled: true, currency: 'CAD', rate: 1.4 }; }, false);
    await f.refresh();
    const cad = f.service.historical('2026-09-21');
    expect(cad).toMatchObject({ displayConversion: { enabled: true, currency: 'CAD', rate: 1.4 }, netWorthCents: legacy.netWorthCents });
    vi.setSystemTime(new Date('2026-09-22T18:00:00Z'));
    await f.repo.change(state => { state.settings!.displayConversion = { enabled: false, currency: 'EUR', rate: 0.9 }; }, false);
    await f.refresh();
    expect(f.service.historical('2026-09-22')).toMatchObject({ displayConversion: { enabled: false, currency: 'EUR', rate: 0.9 }, netWorthCents: legacy.netWorthCents });
    expect(f.service.historical('2026-09-21')).toEqual(cad);
    expect(f.service.historical('2026-09-20')).toEqual(legacy);
    await f.repo.close();
    const backup = await createBackup(f.dir);
    await restoreBackup(f.dir, backup);
    const restored = await new Repository(f.dir).initialize();
    try {
      expect(restored.snapshot().wealth!.history!['2026-09-21']).toEqual(cad);
      expect(restored.snapshot().wealth!.history!['2026-09-20']).toEqual(legacy);
    } finally { await restored.close(); }
  } finally { vi.useRealTimers(); await f.close(); }
});
