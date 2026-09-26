import { SqliteStore, DATABASE_NAME } from '../src/server/storage/sqlite-store.js';
import { expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Repository } from '../src/server/storage/repository.js';
import { Connections } from '../src/server/services/connections.js';
import { Jobs } from '../src/server/services/jobs.js';
import { syncTransactions } from '../src/server/services/transactions-sync.js';
import { readConfig } from '../src/server/config.js';
import { PlaidFailure } from '../src/server/integrations/plaid/client.js';
import { fakePlaid, syncPage, transaction } from './fixtures/plaid.js';
import { monthRange } from '../src/shared/models.js';

it('accepts the current Pacific month through today, rejects tomorrow, and keeps sync incremental', async () => {
  const f = await fixture();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-14T06:00:00Z'));
  try {
    const publisher = vi.fn(async () => ({ failed: 0, total: 0 }));
    const jobs = new Jobs(f.repository, f.plaid, { attempts: 1, delayMs: 0 }, publisher);
    const job = await jobs.enqueue({ type: 'sync', range: monthRange('2026-09'), force: true });
    await jobs.idle();
    expect(job.range).toEqual({ start: '2026-09-01', end: '2026-09-13' });
    expect(job.force).toBe(false);
    expect(publisher).toHaveBeenCalledWith([f.account.id], false, expect.any(Function), job.range);
    expect(f.repository.snapshot().jobs[job.id].status).toBe('succeeded');
    await expect(jobs.enqueue({ type: 'sync', range: { start: '2026-09-01', end: '2026-09-14' } })).rejects.toThrow('Select a date range');
  } finally { vi.useRealTimers(); await f.close(); }
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'respect-money-sync-')); const repository = await new Repository(dir).initialize();
  const plaid = fakePlaid(); const connections = new Connections(repository, plaid, readConfig());
  const session = await connections.createLink();
  await connections.completeLink({ sessionId: session.sessionId, publicToken: 'public', institution: 'Chase' });
  const account = repository.snapshot().accounts[0];
  return { dir, repository, plaid, connections, account, close: async () => { await repository.close(); await rm(dir, { recursive: true, force: true }); } };
}

it('commits a full cursor round, retries pagination mutations and retains historical corrections', async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const cursors: (string | undefined)[] = [];
    f.plaid.sync = async (_token, cursor) => {
      cursors.push(cursor); calls++;
      if (calls === 1) return syncPage('partial', [transaction('discarded')], { has_more: true });
      if (calls === 2) throw new PlaidFailure('TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION');
      return syncPage('complete', [transaction('a'), transaction('older', '2025-06-01')]);
    };
    await syncTransactions(f.repository, f.plaid, 'item', [f.account.id], { start: '2026-01-01', end: '2026-08-31' });
    expect(cursors).toEqual([undefined, 'partial', undefined]);
    expect(Object.values(f.repository.snapshot().records).map((r) => r.payload.transaction_id)).toEqual(['a', 'older']);
    expect(f.repository.snapshot().processed).toHaveLength(0);
    await f.repository.change((s) => { s.staleAccountIds = []; });
    expect(f.repository.snapshot().processed).toHaveLength(1);
    f.plaid.sync = async () => syncPage('new', [], { modified: [transaction('a', '2026-07-31', 20)], removed: [{ transaction_id: 'older' }] });
    await syncTransactions(f.repository, f.plaid, 'item', [f.account.id], { start: '2026-08-01', end: '2026-08-31' });
    await f.repository.change((s) => { s.staleAccountIds = []; });
    expect(f.repository.snapshot().processed[0]).toMatchObject({ postedDate: '2026-07-31', cashflowCents: -2000 });
    expect(f.repository.snapshot().ranges[f.account.id][0].start).toBe('2026-01-01');
    expect(f.repository.snapshot().connections.item.cursor).toBe('new');
    const stored = SqliteStore.open(join(f.dir, DATABASE_NAME), true);
    try { expect(Object.values(stored.load().records)[0].payload.date).toBe('2026-07-31'); } finally { stored.close(); }
  } finally { await f.close(); }
});

it('keeps the old cursor/data after a failed page and deduplicates queued jobs', async () => {
  const f = await fixture();
  try {
    f.plaid.sync = async (_token, cursor) => { if (!cursor) return syncPage('partial', [transaction('a')], { has_more: true }); throw new PlaidFailure('NETWORK_ERROR'); };
    await expect(syncTransactions(f.repository, f.plaid, 'item', [f.account.id], { start: '2026-01-01', end: '2026-08-31' })).rejects.toThrow();
    expect(f.repository.snapshot().connections.item.cursor).toBeUndefined(); expect(f.repository.snapshot().records).toEqual({});
    f.plaid.sync = fakePlaid().sync;
    const jobs = new Jobs(f.repository, f.plaid, { attempts: 1, delayMs: 0 });
    const input = { type: 'sync' as const, range: { start: '2026-01-01', end: '2026-08-31' } };
    const [a, b] = await Promise.all([jobs.enqueue(input), jobs.enqueue(input)]);
    expect(a.id).toBe(b.id); await jobs.idle();
    expect(f.repository.snapshot().jobs[a.id].status).toBe('succeeded'); expect(f.repository.snapshot().processed).toHaveLength(1);
  } finally { await f.close(); }
});

it('requests 730 days initially and uses update mode without exchanging a new Item', async () => {
  const f = await fixture();
  try {
    const create = vi.spyOn(f.plaid, 'createLink'); const exchange = vi.spyOn(f.plaid, 'exchange');
    await f.connections.createLink(); expect(create.mock.calls[0][0].transactions?.days_requested).toBe(730);
    const session = await f.connections.createLink('item');
    expect(create.mock.calls[1][0].access_token).toBe('secret-test-token'); expect(create.mock.calls[1][0].products).toBeUndefined();
    await f.repository.change((state) => { state.accounts[0].enabled = false; });
    await f.connections.completeLink({ sessionId: session.sessionId, institution: 'Chase', selectedAccountIds: ['bank-account'] });
    expect(exchange).not.toHaveBeenCalled(); expect(f.repository.snapshot().accounts).toHaveLength(1);
    expect(f.repository.snapshot().accounts[0].enabled).toBe(false);
  } finally { await f.close(); }
});
