import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { Repository } from '../src/server/storage/repository.js';
import { SqliteStore } from '../src/server/storage/sqlite-store.js';
import { stateDigest } from '../src/server/storage/state-validation.js';
import { Connections } from '../src/server/services/connections.js';
import { WealthService } from '../src/server/services/wealth.js';
import { ReclassificationService } from '../src/server/services/reclassification.js';
import { Jobs } from '../src/server/services/jobs.js';
import { syncTransactions } from '../src/server/services/transactions-sync.js';
import { normalize, transactionId } from '../src/server/domain/ledger.js';
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

it('revokes only the selected connection and deletes its accounts, ledger and historical balances atomically', async () => {
  const f = await fixture();
  try {
    const update = await f.connections.createLink('bank-item');
    const other = await f.connections.createLink('invest-item');
    const before = f.repo.snapshot();
    await f.connections.disconnect('bank-item');
    expect(f.remove).toHaveBeenCalledExactlyOnceWith('fixture-bank-token');
    const after = f.repo.snapshot();
    expect(after.accounts.some(a => a.id === f.bank.id)).toBe(false);
    for (const key of ['records', 'overrides', 'classifications', 'ranges'] as const) expect(after[key]).toEqual({});
    expect(after.processed).toEqual([]);
    expect(after.staleAccountIds).toEqual([]);
    for (const snapshot of Object.values(after.wealth!.history!)) {
      expect(snapshot.accounts.map(a => a.id)).toEqual(before.accounts.filter(a => a.id !== f.bank.id).map(a => a.id));
      expect(snapshot).toMatchObject({ assetsCents: 7500000, netWorthCents: 7500000 });
      expect(snapshot.allocation.reduce((sum, part) => sum + part.valueCents, 0)).toBe(7500000);
    }
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
    await expect(jobs.enqueue({ type: 'classify', range, accountIds: [f.bank.id] })).rejects.toThrow('Invalid synchronization account');
    await f.repo.close(); await f.repo.initialize();
    expect(f.repo.snapshot().accounts.some(a => a.id === f.bank.id)).toBe(false);
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


it('removes every account on an Item, split rows, notes, stale flags, jobs and merge links without changing other accounts', async () => {
  const f = await fixture();
  try {
    const manual = await f.repo.addAccount({ name: 'Independent cash', institution: 'Manual', type: 'cash', mask: '' });
    const kept = await f.repo.addManual({ accountId: manual.id, postedDate: '2026-08-10', description: 'Keep this purchase', amount: '25', kind: 'expense', category: 'shopping', country: 'US', notes: 'Keep this note' });
    const tx = Object.values(f.repo.snapshot().records).find(r => r.accountId === f.bank.id)!;
    const id = transactionId(tx);
    await f.repo.editOverride(id, f.repo.version(f.repo.snapshot(), id), { splits: [
      { id: 'part-a', description: 'Sample meal', cashflowCents: -5000, category: 'dining', country: 'JP', kind: 'expense' },
      { id: 'part-b', description: 'Sample groceries', cashflowCents: -5000, category: 'groceries', country: 'JP', kind: 'expense' },
    ] });
    await f.repo.change(state => {
      const second = { ...f.bank, id: 'second-account', plaidAccountId: 'second-provider-account' };
      state.accounts.push(second);
      const record = { ...tx, accountId: second.id };
      state.records[transactionId(record)] = record;
      state.ranges[second.id] = [range];
      state.connections['invest-item'].mergedAccounts = { old: f.bank.id, keep: manual.id };
      for (const [jobId, accountIds] of [['removed', [f.bank.id, manual.id]], ['kept', [manual.id]]] as const) {
        state.jobs[jobId] = { id: jobId, accountIds: [...accountIds], type: 'sync', status: 'succeeded', range, force: false, refresh: false, createdAt: '', updatedAt: '', progress: 1, total: 1, message: 'Sample job details', errors: [] };
      }
      state.overrides.orphan = { revision: 1, updatedAt: '', notes: 'Old provider-removed transaction note' };
    });
    await f.repo.change(state => { state.staleAccountIds = [f.bank.id, 'second-account']; }, false);
    const before = f.repo.snapshot();
    expect(before.processed.filter(r => r.parentId === id)).toHaveLength(2);
    await f.connections.disconnect('bank-item');
    const after = f.repo.snapshot();
    expect(after.accounts.map(a => a.id)).toEqual(before.accounts.filter(a => a.itemId !== 'bank-item').map(a => a.id));
    expect(after.records).toEqual({ [kept]: before.records[kept] });
    expect(after.processed).toEqual(before.processed.filter(r => r.accountId === manual.id));
    expect(after.overrides).toEqual({}); expect(after.classifications).toEqual({});
    expect(after.ranges).toEqual({}); expect(after.staleAccountIds).toEqual([]);
    expect(after.jobs).toEqual({ kept: before.jobs.kept });
    expect(after.connections['invest-item'].mergedAccounts).toEqual({ keep: manual.id });
    await f.repo.close(); await f.repo.initialize();
    expect(f.repo.snapshot()).toEqual(after);
  } finally { await f.close(); }
});

it('detaches a retained manual duplicate and updates its published row when the original account is deleted', async () => {
  const f = await fixture();
  try {
    const manual = await f.repo.addAccount({ name: 'Cash', institution: 'Manual', type: 'cash', mask: '' });
    const id = await f.repo.addManual({ accountId: manual.id, postedDate: '2026-08-03', description: 'Manual cafe entry', amount: '100', kind: 'expense', category: 'dining', country: 'JP', notes: 'Keep' });
    const original = Object.values(f.repo.snapshot().records).find(r => r.accountId === f.bank.id)!;
    await f.repo.editOverride(id, f.repo.version(f.repo.snapshot(), id), { duplicateOf: transactionId(original) });
    expect(f.repo.snapshot().processed.find(r => r.id === id)?.excluded).toBe(true);
    await f.connections.disconnect('bank-item');
    const state = f.repo.snapshot();
    expect(state.overrides[id].duplicateOf).toBeUndefined();
    expect(state.processed.find(r => r.id === id)).toMatchObject({ excluded: false, kind: 'expense', notes: 'Keep', version: f.repo.version(state, id) });
  } finally { await f.close(); }
});

it('cleans up accounts retained by an older disconnect on restart, and removes empty history snapshots', async () => {
  const f = await fixture();
  try {
    await f.repo.change(state => {
      for (const account of state.accounts) account.disconnectedAt = new Date().toISOString();
      state.connections = {}; state.vault.tokens = {};
    }, false);
    await f.repo.close(); await f.repo.initialize();
    const state = f.repo.snapshot();
    expect(state.accounts).toEqual([]); expect(state.records).toEqual({});
    expect(state.processed).toEqual([]); expect(state.overrides).toEqual({});
    expect(state.classifications).toEqual({}); expect(state.ranges).toEqual({});
    expect(state.wealth!.balances).toEqual({}); expect(state.wealth!.history).toEqual({});
    await f.repo.close(); await f.repo.initialize();
    expect(f.repo.snapshot()).toEqual(state);
  } finally { await f.close(); }
});

it.each([false, true])('invalidates reclassification previews after disconnect, including a delayed scan: %s', async delayed => {
  const f = await fixture(); let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const service = new ReclassificationService(f.repo, () => async (_rule, inputs) => {
    if (delayed) await gate;
    return { reviewedCount: inputs.length, matches: inputs.map(input => ({ ref: input.ref, reason: 'Synthetic match' })) };
  });
  try {
    const rule = await service.save({ example: 'Synthetic spending', category: 'housing', direction: 'outgoing' });
    const preview = service.start(rule.id);
    if (!delayed) { await service.close(); expect(service.get(preview.id).matches.length).toBeGreaterThan(0); }
    await f.connections.disconnect('bank-item');
    expect(service.latest()).toBeNull();
    expect(() => service.get(preview.id)).toThrow('expired');
    release(); await service.close();
    expect(service.latest()).toBeNull();
    expect(f.repo.snapshot().overrides).toEqual({});
  } finally { release(); await service.close(); await f.close(); }
});

it('does not restore a removed institution error when a balance refresh fails after disconnect', async () => {
  const f = await fixture(); let release = () => {};
  try {
    const gate = new Promise<void>(resolve => { release = resolve; });
    const original = f.plaid.accounts;
    const reads = vi.spyOn(f.plaid, 'accounts').mockImplementation(async token => {
      if (token === 'fixture-bank-token') { await gate; throw new PlaidFailure('INSTITUTION_DOWN'); }
      return original(token);
    });
    f.wealth.refresh(); await vi.waitFor(() => expect(reads).toHaveBeenCalled());
    await f.connections.disconnect('bank-item'); release(); await f.wealth.close();
    expect(f.wealth.summary().errors).toEqual([]);
    for (const entry of Object.values(f.repo.snapshot().wealth!.history!)) {
      expect(entry.errors).toEqual([]);
      expect(entry.accounts.some(a => a.id === f.bank.id)).toBe(false);
    }
  } finally { release(); await f.close(); }
});

it('preserves independently entered assets and unknown historical debt across successive account deletions', async () => {
  const f = await fixture();
  try {
    await f.repo.change(state => {
      state.wealth!.balances[f.bank.id] = { netCents: -300000, currency: 'USD', debtAccount: true, fetchedAt: '', allocation: [], allocationIncomplete: false };
      const asset = { id: 'home', revision: 0, name: 'Manual home', kind: 'property' as const, valueCents: 800000, debtCents: 0, debtAccountId: f.bank.id, address: '', vehicleModel: '', valuationDate: '2026-01-01' };
      state.wealth!.assets.push(asset);
      const captured = Object.values(state.wealth!.history!)[0];
      captured.assets.push({ ...asset, effectiveDebtCents: null, equityCents: null });
      captured.accounts.find(a => a.id === f.bank.id)!.balance = null;
      captured.partial = true;
    }, false);
    await f.connections.disconnect('bank-item');
    let captured = Object.values(f.repo.snapshot().wealth!.history!)[0];
    expect(captured.assets[0]).toMatchObject({ debtAccountId: null, effectiveDebtCents: null, equityCents: null });
    expect(captured).toMatchObject({ assetsCents: 8300000, debtsCents: 0, missingAccounts: 1, partial: true });
    await f.connections.disconnect('invest-item');
    const state = f.repo.snapshot(); captured = Object.values(state.wealth!.history!)[0];
    expect(state.wealth!.assets[0]).toMatchObject({ name: 'Manual home', debtCents: 300000, debtAccountId: null });
    expect(captured.accounts).toEqual([]);
    expect(captured.assets[0]).toMatchObject({ effectiveDebtCents: null, equityCents: null });
    expect(captured).toMatchObject({ assetsCents: 800000, debtsCents: 0, missingAccounts: 1, partial: true });
  } finally { await f.close(); }
});

it('clears connection errors even when account discovery never succeeded', async () => {
  const f = await fixture();
  try {
    await f.repo.change(state => {
      state.connections.empty = { id: 'empty', institution: 'Unfinished bank', products: [], status: 'error' };
      state.vault.tokens.empty = 'synthetic-empty-token';
      const error = { name: 'Unfinished bank', error: 'Synthetic discovery failure' };
      state.wealth!.errors.push(error);
      for (const snapshot of Object.values(state.wealth!.history!)) { snapshot.errors.push(error); snapshot.partial = true; }
    }, false);
    const before = f.repo.snapshot();
    await f.connections.disconnect('empty');
    const after = f.repo.snapshot();
    expect(after.accounts).toEqual(before.accounts); expect(after.records).toEqual(before.records);
    expect(after.wealth!.errors).toEqual([]);
    for (const snapshot of Object.values(after.wealth!.history!)) {
      expect(snapshot.errors).toEqual([]); expect(snapshot.partial).toBe(false);
      expect(snapshot.assetsCents).toBe(8750000);
    }
  } finally { await f.close(); }
});
