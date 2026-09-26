import { DatabaseSync } from 'node:sqlite';
import { DATABASE_NAME } from '../src/server/storage/sqlite-store.js';
import { mkdtemp, readFile, rm, readdir, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Repository } from '../src/server/storage/repository.js';
import { AtomicFiles } from '../src/server/storage/atomic-files.js';
import { summarize, transactionId } from '../src/server/domain/ledger.js';
import { type RawRecord } from '../src/shared/models.js';

const directories: string[] = [];
async function directory() { const path = await mkdtemp(join(tmpdir(), 'respect-money-test-')); directories.push(path); return path; }
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });

describe('SQLite storage and recovery', () => {
  it('restores manual changes and splits after restart and rejects stale edits', async () => {
    const path = await directory();
    let repository = await new Repository(path).initialize();
    const account = await repository.addAccount({ name: 'Fictional card', institution: 'Test Bank', type: 'credit', mask: '0000' });
    const id = await repository.addManual({ accountId: account.id, postedDate: '2026-08-10', description: 'Fictional groceries', amount: '150.00', kind: 'expense', category: 'shopping', country: 'US', notes: '' });
    const oldVersion = repository.version(repository.snapshot(), id);
    await repository.editOverride(id, oldVersion, { country: 'JP', splits: [
      { cashflowCents: -10000, category: 'groceries', country: 'JP', kind: 'expense', description: 'Food' },
      { cashflowCents: -5000, category: 'shopping', country: 'JP', kind: 'expense', description: 'Household' },
    ] });
    await expect(repository.editOverride(id, oldVersion, { country: 'CN' })).rejects.toMatchObject({ statusCode: 409 });
    expect(summarize(repository.snapshot().processed).expenseCents).toBe(15000);
    await repository.close();
    repository = await new Repository(path).initialize();
    try {
      expect(repository.snapshot().processed).toHaveLength(2);
      expect(repository.snapshot().overrides[id].country).toBe('JP');
      expect(summarize(repository.snapshot().processed).expenseCents).toBe(15000);
    } finally { await repository.close(); }
  });
  it('persists corrected transaction dates and does not revive removed transactions through overrides', async () => {
    const path = await directory();
    const repository = await new Repository(path).initialize();
    try {
      const account = await repository.addAccount({ name: 'Fictional', institution: 'Chase', type: 'credit', mask: '1827' });
      const record: RawRecord = { accountId: account.id, source: 'plaid_transactions', payload: { transaction_id: 'fictional', date: '2026-08-31', amount: 10, iso_currency_code: 'USD', name: 'Fictional store' } };
      const id = transactionId(record);
      const ranges = { [account.id]: [{ start: '2026-01-01', end: '2026-12-31' }] };
      await repository.importRecords([record], ranges);
      await repository.importRecords([record], ranges);
      expect(repository.snapshot().processed).toHaveLength(1);
      await repository.editOverride(id, repository.version(repository.snapshot(), id), { category: 'dining', country: 'CN' });
      await repository.importRecords([{ ...record, payload: { ...record.payload, date: '2026-09-01', amount: 20 } }], ranges);
      const db = new DatabaseSync(join(path, DATABASE_NAME), { readOnly: true });
      try { expect(db.prepare('SELECT posted_date FROM raw_records').get()?.posted_date).toBe('2026-09-01'); } finally { db.close(); }
      expect(repository.snapshot().processed[0]).toMatchObject({ country: 'CN', category: 'dining', cashflowCents: -2000 });
      await repository.importRecords([], ranges, [id]);
      expect(repository.snapshot().processed).toHaveLength(0);
      expect(repository.snapshot().overrides[id].country).toBe('CN');
      const persisted = new DatabaseSync(join(path, DATABASE_NAME), { readOnly: true });
      try { expect(persisted.prepare('SELECT data FROM transaction_overrides WHERE id = ?').get(id)?.data).toContain('CN'); } finally { persisted.close(); }
    } finally { await repository.close(); }
  });
  it('rolls forward a partially applied month/cursor transaction on restart', async () => {
    const path = await directory();
    const interrupted = new AtomicFiles(path, (index) => { if (index === 1) throw new Error('Simulated crash'); });
    await interrupted.initialize();
    await expect(interrupted.write({ 'raw/month.json': '{"amount":100}', 'meta/cursor.json': '{"cursor":"next"}' })).rejects.toThrow('Simulated crash');
    await interrupted.close();
    const recovered = new AtomicFiles(path);
    await recovered.initialize();
    try {
      expect(JSON.parse(await readFile(join(path, 'raw/month.json'), 'utf8'))).toEqual({ amount: 100 });
      expect(JSON.parse(await readFile(join(path, 'meta/cursor.json'), 'utf8'))).toEqual({ cursor: 'next' });
      expect(await readdir(join(path, '.staging'))).toEqual([]);
    } finally { await recovered.close(); }
  });
  it('refuses concurrent application writers', async () => {
    const path = await directory();
    const first = await new Repository(path).initialize();
    try { await expect(new Repository(path).initialize()).rejects.toThrow("Another application instance"); }
    finally { await first.close(); }
  });
  it('reports corrupt data and interrupted jobs without leaving a live-process lock behind', async () => {
    const path = await directory();
    let repository = await new Repository(path).initialize();
    await repository.change((s) => { s.jobs.test = { id: 'test', type: 'sync', status: 'fetching', accountIds: [], range: { start: '2026-01-01', end: '2026-08-01' }, force: false, refresh: false, createdAt: '2026-08-01', updatedAt: '2026-08-01', progress: 0, total: 1, message: '', errors: [] }; });
    await repository.close(); repository = await new Repository(path).initialize();
    expect(repository.snapshot().jobs.test.status).toBe('interrupted');
    await repository.close();
    await writeFile(join(path, DATABASE_NAME), '{invalid');
    await expect(new Repository(path).initialize()).rejects.toThrow();
    const writer = new AtomicFiles(path); await writer.initialize(); await writer.close();
    await mkdir(join(path, '.staging', 'broken'));
    await writeFile(join(path, '.staging', 'broken', 'manifest.json'), '{}');
    await expect(new AtomicFiles(path).initialize()).rejects.toThrow("Invalid recovery journal");
    expect(await readdir(path)).not.toContain('.writer-lock');
  });
});
