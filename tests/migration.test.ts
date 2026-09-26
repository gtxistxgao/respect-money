import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { createLedger, normalize, summarize, transactionId } from '../src/server/domain/ledger.js';
import { AtomicFiles } from '../src/server/storage/atomic-files.js';
import { createBackup, restoreBackup } from '../src/server/storage/backups.js';
import { decodeLegacy, legacyDocuments } from '../src/server/storage/legacy-json.js';
import { migrateLegacyData } from '../src/server/storage/migration.js';
import { Repository } from '../src/server/storage/repository.js';
import { DATABASE_NAME, SqliteStore } from '../src/server/storage/sqlite-store.js';
import { emptyState, type RepositoryState } from '../src/server/storage/state.js';
import { stateDigest } from '../src/server/storage/state-validation.js';
import type { RawRecord } from '../src/shared/models.js';

const directories: string[] = [];
async function directory() { const path = await mkdtemp(join(tmpdir(), 'respect-money-migration-')); directories.push(path); return path; }
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
function fixture() {
  const s = emptyState(); s.revision = 42; s.vault.userId = 'fixture-user';
  s.accounts = [
    { id: 'bank', name: 'Fictional card', institution: 'Test', mask: '0000', type: 'credit', source: 'plaid', enabled: true, itemId: 'item', plaidAccountId: 'upstream-account', createdAt: '2026-08-01' },
    { id: 'manual', name: 'Fictional cash', institution: 'Test', mask: '', type: 'cash', source: 'manual', enabled: true, createdAt: '2026-08-01' },
  ];
  s.connections.item = { id: 'item', institution: 'Test', products: ['transactions', 'investments'], cursor: 'fixture-cursor', status: 'connected', lastError: '', requestedHistoryDays: 730 };
  s.ranges = { bank: [{ start: '2025-01-01', end: '2026-12-31' }], manual: [] };
  s.jobs.job = { id: 'job', type: 'sync', status: 'succeeded', accountIds: ['bank'], range: s.ranges.bank[0], force: false, refresh: true, createdAt: '2026-08-01', updatedAt: '2026-08-02', progress: 2, total: 2, message: 'fixture', errors: [] };
  s.vault.tokens.item = 'fixture-secret-token';
  s.vault.links.session = { token: 'fixture-link-token', product: 'transactions', connectionId: 'item', isUpdate: true, expiresAt: '2099-01-01' };
  const records: RawRecord[] = [
    { accountId: 'bank', source: 'plaid_transactions', payload: { transaction_id: 'purchase', date: '2026-08-01', amount: 15, name: 'Fictional purchase', iso_currency_code: 'USD', unknown_nested: { z: null, a: [false, "Preserve original text", 123] }, location: { country: 'CN' } } },
    { accountId: 'bank', source: 'plaid_investments', payload: { investment_transaction_id: 'dividend', date: '2026-09-01', amount: -2.01, name: 'Fictional dividend', iso_currency_code: 'USD', type: 'cash', subtype: 'dividend', security_id: 'security', _security: { name: 'Fictional fund', extra: null } } },
    { accountId: 'manual', source: 'manual', payload: { id: 'manual_fixture', postedDate: '2026-08-02', cashflowCents: -999, description: 'Fictional manual', kind: 'expense', category: 'childcare', country: 'US', notes: '' } },
  ];
  for (const record of records) s.records[transactionId(record)] = record;
  const id = transactionId(records[0]);
  s.overrides[id] = { revision: 3, updatedAt: '2026-08-03', country: 'JP', duplicateOf: null, splits: [
    { id: 'part-a', description: 'Food', cashflowCents: -1000, category: 'groceries', country: 'JP', kind: 'expense' },
    { id: 'part-b', description: 'Transfer', cashflowCents: -500, category: 'internal_transfer', country: 'JP', kind: 'expense' },
  ] };
  s.overrides.orphan = { revision: 2, updatedAt: '2026-07-01', notes: 'Preserve removed source override', excluded: true };
  s.classifications[id] = { sourceHash: normalize(records[0]).sourceHash, kind: 'expense', category: 'shopping', country: 'CN', countrySource: 'ai', reason: 'Fixture classification', needsReview: false, classifiedAt: '2026-08-01', classifierVersion: 'fixture-version' };
  s.processed = createLedger(records, s.accounts, s.overrides, s.classifications, s.ranges);
  // Deliberately retain a published snapshot older than its source (failed classification).
  s.staleAccountIds = ['bank']; records[0].payload.amount = 20;
  return s;
}
function encode(s: RepositoryState) {
  const { vault, records, overrides, classifications, processed, ...metadata } = s;
  const docs: Record<string, string> = { 'meta/state.json': JSON.stringify(metadata), 'meta/classifications.json': JSON.stringify(classifications), 'private/plaid.json': JSON.stringify(vault), 'overrides/orphans.json': JSON.stringify({ schemaVersion: 1, changes: overrides }) };
  for (const record of Object.values(records)) {
    const month = normalize(record).postedDate.slice(0, 7);
    const file = `${record.source === 'manual' ? 'manual' : 'raw'}/${month}-${record.accountId}-${record.source}.json`;
    docs[file] = JSON.stringify({ schemaVersion: 1, month, accountId: record.accountId, source: record.source, transactions: [record.payload] });
  }
  for (const row of processed) {
    const month = row.postedDate.slice(0, 7); const file = `processed/${month}-${row.accountId}.json`;
    const doc = docs[file] ? JSON.parse(docs[file]) : { schemaVersion: 1, month, accountId: row.accountId, transactions: [] };
    doc.transactions.push(row); docs[file] = JSON.stringify(doc);
  }
  return docs;
}
async function seed(root: string, docs = encode(fixture())) {
  for (const [file, value] of Object.entries(docs)) { await mkdir(dirname(join(root, file)), { recursive: true }); await writeFile(join(root, file), value); }
  return decodeLegacy(await legacyDocuments(root));
}

it('migrates every collection losslessly, retains published snapshots, and never imports JSON twice', async () => {
  const root = await directory(); const before = await seed(root); const files = await legacyDocuments(root);
  await expect(new Repository(root).initialize()).rejects.toThrow('migrate:sqlite');
  expect(await readdir(root)).not.toContain(DATABASE_NAME);
  const result = await migrateLegacyData(root); expect(result.alreadyMigrated).toBe(false);
  expect((await stat(join(root, DATABASE_NAME))).mode & 0o777).toBe(0o600);
  expect(await legacyDocuments(root)).toEqual(files);
  let repository = await new Repository(root).initialize();
  try {
    const after = repository.snapshot(); expect(after).toEqual(before); expect(stateDigest(after)).toBe(stateDigest(before));
    expect(summarize(after.processed)).toEqual(summarize(before.processed));
    for (const [id, record] of Object.entries(before.records)) expect(normalize(after.records[id]).sourceHash).toBe(normalize(record).sourceHash);
    await repository.addManual({ accountId: 'manual', postedDate: '2026-09-02', description: 'New SQLite record', amount: '1.00', kind: 'expense', category: 'childcare', country: 'US', notes: '' });
  } finally { await repository.close(); }
  const second = await migrateLegacyData(root); expect(second.alreadyMigrated).toBe(true);
  repository = await new Repository(root).initialize();
  try { expect(Object.keys(repository.snapshot().records)).toHaveLength(4); } finally { await repository.close(); }
  expect(await legacyDocuments(root)).toEqual(files);
  const jsonBackup = join(root, (result.report as { backup: string }).backup);
  await restoreBackup(root, jsonBackup);
  const store = SqliteStore.open(join(root, DATABASE_NAME), true);
  try { expect(store.load()).toEqual(before); } finally { store.close(); }
  const nativeBackup = await createBackup(root); const fresh = await directory();
  expect(await restoreBackup(fresh, nativeBackup)).toBeNull();
  const copy = SqliteStore.open(join(fresh, DATABASE_NAME), true);
  try { expect(copy.load()).toEqual(before); } finally { copy.close(); }
});

it('recovers a committed legacy journal before migration and blocks live legacy writers', async () => {
  const root = await directory(); await seed(root);
  const next = fixture(); next.revision++;
  const writer = new AtomicFiles(root, () => { throw new Error('Simulated power loss'); }); await writer.initialize();
  await expect(migrateLegacyData(root)).rejects.toThrow("Another application instance");
  await expect(writer.write(encode(next))).rejects.toThrow('power loss'); await writer.close();
  await migrateLegacyData(root);
  const store = SqliteStore.open(join(root, DATABASE_NAME), true);
  try { expect(store.load().revision).toBe(next.revision); } finally { store.close(); }
  expect(await readdir(join(root, '.staging'))).toEqual([]);
});

it.each(['duplicate', 'malformed', 'unmapped'])('aborts %s legacy data without creating a database or changing source files', async (failure) => {
  const root = await directory(); await seed(root);
  if (failure === 'duplicate') { const files = await legacyDocuments(root); const file = Object.keys(files).find((name) => name.startsWith('raw/'))!; await writeFile(join(root, 'raw/duplicate.json'), files[file]); }
  if (failure === 'malformed') await writeFile(join(root, 'meta/state.json'), '{bad');
  if (failure === 'unmapped') { const metadata = JSON.parse(await readFile(join(root, 'meta/state.json'), 'utf8')); metadata.futureField = { preserve: true }; await writeFile(join(root, 'meta/state.json'), JSON.stringify(metadata)); }
  const before = await legacyDocuments(root);
  await expect(migrateLegacyData(root)).rejects.toThrow();
  expect(await legacyDocuments(root)).toEqual(before);
  expect(await readdir(root)).not.toContain(DATABASE_NAME);
  expect(await readdir(root)).not.toContain('.writer-lock');
});
