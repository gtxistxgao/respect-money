import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { Repository } from '../src/server/storage/repository.js';
import { DATABASE_NAME, SqliteStore } from '../src/server/storage/sqlite-store.js';

it('rolls back a late SQL failure with its cursor and revision, then permits a successful retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'respect-money-transaction-'));
  const repository = await new Repository(root).initialize();
  const db = new DatabaseSync(join(root, DATABASE_NAME));
  try {
    const account = await repository.addAccount({ name: 'Fictional', institution: 'Test', mask: '', type: 'cash' });
    const before = repository.snapshot();
    db.exec("CREATE TRIGGER simulated_failure BEFORE INSERT ON processed_transactions BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END;");
    const change = () => repository.change((s) => {
      s.connections.item = { id: 'item', institution: 'Test', products: ['transactions'], status: 'connected', cursor: 'new-cursor' };
      s.records.manual_test = { accountId: account.id, source: 'manual', payload: { id: 'manual_test', postedDate: '2026-08-01', cashflowCents: -123, description: 'Test', kind: 'expense', category: 'childcare', country: 'US' } };
    });
    await expect(change()).rejects.toThrow('simulated disk failure'); expect(repository.snapshot()).toEqual(before);
    const stored = SqliteStore.open(join(root, DATABASE_NAME), true);
    try { expect(stored.load()).toEqual(before); } finally { stored.close(); }
    db.exec('DROP TRIGGER simulated_failure'); await change();
    expect(repository.snapshot().connections.item.cursor).toBe('new-cursor');
    expect(repository.snapshot().processed[0].cashflowCents).toBe(-123);
  } finally { db.close(); await repository.close(); await rm(root, { recursive: true, force: true }); }
});

it('recovers after a process dies with an uncommitted SQLite transaction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'respect-money-crash-')); const database = join(root, DATABASE_NAME);
  const repository = await new Repository(root).initialize();
  await repository.addAccount({ name: 'Fictional', institution: 'Test', mask: '', type: 'cash' });
  const before = repository.snapshot(); await repository.close();
  try {
    const killed = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { DatabaseSync } from 'node:sqlite';
      const db = new DatabaseSync(process.argv[1]);
      db.exec("PRAGMA cache_size=1; BEGIN IMMEDIATE; UPDATE app_metadata SET data=json_set(data, '$.revision', 999); DELETE FROM accounts;");
      process.kill(process.pid, 'SIGKILL');
    `, database]);
    expect(killed.signal).toBe('SIGKILL');
    const recovered = await new Repository(root).initialize();
    try { expect(recovered.snapshot()).toEqual(before); } finally { await recovered.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('rejects a revision changed by another writer without overwriting it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'respect-money-conflict-'));
  const repository = await new Repository(root).initialize();
  const other = SqliteStore.open(join(root, DATABASE_NAME));
  try {
    const state = other.load(); state.revision++; other.save(state.revision - 1, state);
    await expect(repository.addAccount({ name: 'Fictional', institution: 'Test', mask: '', type: 'cash' })).rejects.toMatchObject({ statusCode: 409 });
    expect(other.load().accounts).toEqual([]);
  } finally { other.close(); await repository.close(); await rm(root, { recursive: true, force: true }); }
});
