import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { Repository } from '../src/server/storage/repository.js';
import { SqliteStore } from '../src/server/storage/sqlite-store.js';
import { stateDigest } from '../src/server/storage/state-validation.js';
import { Connections } from '../src/server/services/connections.js';
import { WealthService } from '../src/server/services/wealth.js';
import { Jobs } from '../src/server/services/jobs.js';
import { syncTransactions } from '../src/server/services/transactions-sync.js';
import { normalize } from '../src/server/domain/ledger.js';
import { readConfig } from '../src/server/config.js';
import { PlaidFailure } from '../src/server/integrations/plaid/client.js';
import { integrationPlaid } from './fixtures/integration.js';

const range = { start: '2026-08-01', end: '2026-08-31' };
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'respect-money-disconnect-'));
  const repo = await new Repository(dir).initialize();
  const plaid = integrationPlaid();
  const remove = vi.spyOn(plaid, 'removeItem');
  const connections = new Connections(repo, plaid, readConfig(dir));
  for (const [institution, publicToken] of [['Chase', 'fixture-bank-public'], ['Fidelity', 'fixture-invest-public']]) {
    const session = await connections.createLink();
    await connections.completeLink({ sessionId: session.sessionId, publicToken, institution });
  }
  const bank = repo.snapshot().accounts.find(a => a.itemId === 'bank-item')!;
  await syncTransactions(repo, plaid, 'bank-item', [bank.id], range);
  await repo.change(state => {
    state.staleAccountIds = [];
    const tx = normalize(Object.values(state.records)[0]);
    state.classifications[tx.id] = { sourceHash: tx.sourceHash, kind: 'expense', category: 'dining', country: 'JP', countrySource: 'ai', reason: 'Fixture', needsReview: false, classifiedAt: new Date().toISOString(), classifierVersion: 'fixture' };
    state.overrides[tx.id] = { revision: 1, updatedAt: new Date().toISOString(), notes: 'Keep this note' };
  });
  const wealth = new WealthService(repo, plaid); wealth.refresh(); await wealth.close();
  return { dir, repo, plaid, remove, connections, bank, wealth, close: async () => { await wealth.close(); await repo.close(); await rm(dir, { recursive: true, force: true }); } };
}

it('revokes only the selected connection, preserves the ledger and history, and excludes it from future syncs', async () => {
  const f = await fixture();
  try {
    const update = await f.connections.createLink('bank-item');
    const other = await f.connections.createLink('invest-item');
    const before = f.repo.snapshot();
    await f.connections.disconnect('bank-item');
    expect(f.remove).toHaveBeenCalledExactlyOnceWith('fixture-bank-token');
    const after = f.repo.snapshot();
    for (const key of ['records', 'overrides', 'classifications', 'processed', 'ranges'] as const) expect(after[key]).toEqual(before[key]);
    expect(after.wealth?.history).toEqual(before.wealth?.history);
    expect(after.accounts[0]).toMatchObject({ id: f.bank.id, enabled: true, disconnectedAt: expect.any(String) });
    expect(after.vault.tokens).toEqual({ 'invest-item': 'fixture-invest-token' });
    expect(Object.keys(after.connections)).toEqual(['invest-item']);
    expect(after.vault.links[update.sessionId]).toBeUndefined(); expect(after.vault.links[other.sessionId]).toBeDefined();
    expect(f.wealth.summary()).toMatchObject({ assetsCents: 7500000, missingAccounts: 0 });
    const accounts = vi.spyOn(f.plaid, 'accounts');
    f.wealth.refresh(); await f.wealth.close();
    expect(accounts).toHaveBeenCalledExactlyOnceWith('fixture-invest-token');
    const jobs = new Jobs(f.repo, f.plaid, { attempts: 1, delayMs: 0 });
    await expect(jobs.enqueue({ type: 'sync', range, accountIds: [f.bank.id] })).rejects.toThrow('Invalid synchronization account');
    const sync = await jobs.enqueue({ type: 'sync', range }); await jobs.idle();
    expect(sync.accountIds).not.toContain(f.bank.id);
    const classify = await jobs.enqueue({ type: 'classify', range, accountIds: [f.bank.id] }); await jobs.idle();
    expect(f.repo.snapshot().jobs[classify.id].status).toBe('succeeded');
    await f.repo.close(); await f.repo.initialize();
    expect(f.repo.snapshot().accounts[0].disconnectedAt).toBeDefined();
    expect(f.repo.snapshot().vault.tokens['bank-item']).toBeUndefined();
  } finally { await f.close(); }
});

it('preserves the connection and local data when upstream revocation fails', async () => {
  const f = await fixture();
  try {
    f.remove.mockRejectedValueOnce(new PlaidFailure('NETWORK_ERROR'));
    const before = stateDigest(f.repo.snapshot());
    await expect(f.connections.disconnect('bank-item')).rejects.toThrow();
    expect(stateDigest(f.repo.snapshot())).toBe(before);
    await expect(f.connections.disconnect('missing')).rejects.toThrow('Connection not found');
    expect(f.remove).toHaveBeenCalledTimes(1);
  } finally { await f.close(); }
});

it('can retry after upstream removal succeeds but the local commit fails', async () => {
  const f = await fixture();
  try {
    const before = stateDigest(f.repo.snapshot());
    const save = vi.spyOn(SqliteStore.prototype, 'save').mockImplementationOnce(() => { throw new Error('Disk write failed'); });
    try { await expect(f.connections.disconnect('bank-item')).rejects.toThrow('Disk write failed'); } finally { save.mockRestore(); }
    expect(stateDigest(f.repo.snapshot())).toBe(before);
    f.remove.mockRejectedValueOnce(new PlaidFailure('ITEM_NOT_FOUND'));
    await f.connections.disconnect('bank-item');
    expect(f.repo.snapshot().connections['bank-item']).toBeUndefined();
  } finally { await f.close(); }
});

it('preserves linked mortgage debt as a manual amount and rejects unknown debt before revoking', async () => {
  const f = await fixture();
  try {
    await f.repo.change(state => {
      state.wealth!.balances[f.bank.id] = { netCents: -300000, currency: 'USD', debtAccount: true, fetchedAt: new Date().toISOString(), allocation: [], allocationIncomplete: false };
      state.wealth!.assets.push({ id: 'home', revision: 0, name: 'Fixture home', kind: 'property', valueCents: 800000, debtCents: 0, debtAccountId: f.bank.id, address: '', vehicleModel: '', valuationDate: '2026-01-01' });
    }, false);
    const before = f.wealth.summary();
    await f.repo.change(state => { state.wealth!.balances[f.bank.id].netCents = null; }, false);
    await expect(f.connections.disconnect('bank-item')).rejects.toThrow('Enter the outstanding debt manually');
    expect(f.remove).not.toHaveBeenCalled();
    await f.repo.change(state => { state.wealth!.balances[f.bank.id].netCents = -300000; }, false);
    await f.connections.disconnect('bank-item');
    expect(f.repo.snapshot().wealth!.assets[0]).toMatchObject({ debtAccountId: null, debtCents: 300000, revision: 1 });
    expect(f.wealth.summary().netWorthCents).toBe(before.netWorthCents);
  } finally { await f.close(); }
});

it.each(['queued', 'fetching', 'classifying', 'publishing'] as const)('does not revoke during a %s job', async status => {
  const f = await fixture();
  try {
    await f.repo.change(state => { state.jobs.busy = { id: 'busy', type: 'sync', status, range, accountIds: [f.bank.id], force: false, refresh: false, createdAt: '', updatedAt: '', progress: 0, total: 1, message: '', errors: [] }; }, false);
    await expect(f.connections.disconnect('bank-item')).rejects.toThrow('Wait for synchronization');
    expect(f.remove).not.toHaveBeenCalled();
  } finally { await f.close(); }
});

it('blocks a concurrent sync enqueue until removal completes and prevents stale balance reads from resurrecting accounts', async () => {
  const f = await fixture();
  let releaseRemoval = () => {}; let releaseRead = () => {};
  try {
    const original = f.plaid.accounts;
    const gate = new Promise<void>(resolve => { releaseRead = resolve; });
    const reads = vi.spyOn(f.plaid, 'accounts').mockImplementation(async token => { if (token === 'fixture-bank-token') await gate; return original(token); });
    f.wealth.refresh();
    await vi.waitFor(() => expect(reads).toHaveBeenCalled());
    f.remove.mockImplementationOnce(() => new Promise<void>(resolve => { releaseRemoval = resolve; }));
    const disconnect = f.connections.disconnect('bank-item');
    await vi.waitFor(() => expect(f.remove).toHaveBeenCalled());
    const jobs = new Jobs(f.repo, f.plaid);
    const rejected = expect(jobs.enqueue({ type: 'sync', range, accountIds: [f.bank.id] })).rejects.toThrow('Invalid synchronization account');
    releaseRemoval(); await disconnect; await rejected;
    releaseRead(); await f.wealth.close();
    expect(f.repo.snapshot().connections['bank-item']).toBeUndefined();
    expect(f.repo.snapshot().wealth!.balances[f.bank.id]).toBeUndefined();
    expect(f.wealth.summary().accounts).toHaveLength(1);
  } finally { releaseRemoval(); releaseRead(); await f.close(); }
});
