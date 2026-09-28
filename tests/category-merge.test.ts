import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { readConfig } from '../src/server/config.js';
import { createLedger, normalize, summarize, transactionId } from '../src/server/domain/ledger.js';
import { createBackup, restoreBackup } from '../src/server/storage/backups.js';
import { Repository } from '../src/server/storage/repository.js';
import { DATABASE_NAME, SqliteStore } from '../src/server/storage/sqlite-store.js';
import { emptyState } from '../src/server/storage/state.js';
import { type Category, type RawRecord } from '../src/shared/models.js';

it('merges historical categories atomically while preserving amounts, kinds, raw hashes, stale rows and backups', async () => {
  const root = await mkdtemp(join(tmpdir(), 'respect-money-category-merge-'));
  const restoredRoot = await mkdtemp(join(tmpdir(), 'respect-money-category-restored-'));
  // The cast deliberately represents IDs persisted by the previous application.
  const old = (category: string) => category as Category;
  const state = emptyState();
  state.accounts = [{ id: 'fixture', name: 'Fixture', institution: 'Fixture', mask: '', type: 'investment', source: 'manual', enabled: true, createdAt: '2026-01-01' }];
  state.ranges.fixture = [{ start: '2026-01-01', end: '2026-12-31' }];
  const records: RawRecord[] = [
    { accountId: 'fixture', source: 'manual', payload: { id: 'manual-income', postedDate: '2026-08-01', description: 'Investment return', cashflowCents: 10000, kind: 'income', category: 'investment_income', country: 'US', notes: 'Preserve income note' } },
    { accountId: 'fixture', source: 'manual', payload: { id: 'manual-fee', postedDate: '2026-08-01', description: 'Management fee', cashflowCents: -1000, kind: 'expense', category: 'investment_fees', country: 'JP', notes: 'Preserve fee note' } },
    { accountId: 'fixture', source: 'plaid_investments', payload: { investment_transaction_id: 'bank-fee', date: '2026-08-01', name: 'Investment fee', amount: 5, type: 'fee', subtype: 'account fee', iso_currency_code: 'USD' } },
    { accountId: 'fixture', source: 'plaid_transactions', payload: { transaction_id: 'refund', date: '2026-08-01', name: 'Zelle reimbursement', amount: -2, iso_currency_code: 'USD' } },
    { accountId: 'fixture', source: 'plaid_transactions', payload: { transaction_id: 'cached-income', date: '2026-08-01', name: 'Cash yield', amount: -10, iso_currency_code: 'USD' } },
  ];
  for (const record of records) state.records[transactionId(record)] = record;
  const refundId = transactionId(records[3]); const cachedId = transactionId(records[4]);
  state.overrides['manual-fee'] = { revision: 2, updatedAt: '2026-08-02', notes: 'Preserve override', splits: [
    { id: 'fee-part', description: 'Fee', cashflowCents: -600, kind: 'expense', category: old('investment_fees'), country: 'JP' },
    { id: 'other-part', description: 'Other', cashflowCents: -400, kind: 'expense', category: 'shopping', country: 'JP' },
  ] };
  state.overrides[refundId] = { revision: 1, updatedAt: '2026-08-02', category: old('investment_fees'), notes: 'Preserve refund' };
  state.classifications[cachedId] = { sourceHash: normalize(records[4]).sourceHash, kind: 'income', category: old('investment_income'), country: 'US', countrySource: 'default', needsReview: false, reason: 'Cached decision', classifiedAt: '2026-08-02', classifierVersion: 'old-model' };
  state.reclassificationRules = ['investment_income', 'investment_fees'].map((category) => ({ id: randomUUID(), revision: 1, example: 'Synthetic example', category: old(category), direction: 'all' }));
  state.processed = createLedger(records, state.accounts, state.overrides, state.classifications, state.ranges);
  Object.assign(state.processed.find(row => row.id === refundId)!, { kind: 'refund', needsReview: false, category: 'investments' }); // Published by the legacy category/type inference.
  for (const row of state.processed) if (row.category === 'investments') row.category = old(row.cashflowCents > 0 ? 'investment_income' : 'investment_fees');
  state.staleAccountIds = ['fixture']; records[2].payload.amount = 50;
  const store = await SqliteStore.create(join(root, DATABASE_NAME), state); store.close();
  let repository: Repository | undefined;
  try {
    const backup = await createBackup(root);
    repository = await new Repository(root).initialize();
    const merged = repository.snapshot();
    expect(merged.revision).toBe(state.revision + 1);
    expect(merged.records).toEqual(state.records);
    expect(merged.classifications[cachedId]).toEqual({ ...state.classifications[cachedId], category: 'investments' });
    expect(merged.overrides['manual-fee'].splits?.[0]).toMatchObject({ category: 'investments', cashflowCents: -600, kind: 'expense', country: 'JP' });
    expect(merged.overrides[refundId]).toEqual({ ...state.overrides[refundId], category: 'investments', kind: 'refund' });
    expect(merged.reclassificationRules?.every((rule) => rule.category === 'investments')).toBe(true);
    expect(merged.processed).toEqual(state.processed.map((row) => ({ ...row, category: ['investment_income', 'investment_fees'].includes(row.category) ? 'investments' : row.category })));
    expect(summarize(merged.processed)).toEqual(summarize(state.processed));
    expect(merged.staleAccountIds).toEqual(['fixture']);
    await repository.close(); repository = await new Repository(root).initialize();
    expect(repository.snapshot()).toEqual(merged);
    await repository.change((next) => { next.staleAccountIds = []; });
    expect(repository.snapshot().processed.find((row) => row.id === refundId)).toMatchObject({ category: 'investments', kind: 'refund', cashflowCents: 200 });
    await repository.close(); repository = undefined;
    await restoreBackup(restoredRoot, backup);
    repository = await new Repository(restoredRoot).initialize();
    expect(repository.snapshot()).toEqual(merged);
  } finally { await repository?.close(); await rm(root, { recursive: true, force: true }); await rm(restoredRoot, { recursive: true, force: true }); }
});

it('accepts old client IDs but exposes a single category and keeps income, expenses and refunds distinct', async () => {
  const root = await mkdtemp(join(tmpdir(), 'respect-money-category-api-'));
  const app = await buildApp(readConfig(root));
  try {
    const categories = (await app.inject('/api/categories')).json().categories.map((row: { id: string }) => row.id);
    expect(categories.filter((category: string) => ['investments', 'investment_income', 'investment_fees'].includes(category))).toEqual(['investments']);
    const account = (await app.inject({ method: 'POST', url: '/api/accounts/manual', payload: { name: 'Fixture', institution: 'Fixture', type: 'cash' } })).json();
    for (const [kind, category, amount] of [['income', 'investment_income', '100'], ['expense', 'investment_fees', '10'], ['refund', 'investments', '2']]) {
      const response = await app.inject({ method: 'POST', url: '/api/transactions/manual', payload: { accountId: account.id, postedDate: '2026-08-01', description: 'Synthetic investment activity', kind, category, amount } });
      expect(response.statusCode).toBe(201);
    }
    for (const category of ['investments', 'investment_income', 'investment_fees']) {
      const result = (await app.inject(`/api/accounting/transactions?month=2026-08&mode=all&categories=${category}`)).json();
      expect(result.total).toBe(3);
      expect(result.rows.every((row: { category: string }) => row.category === 'investments')).toBe(true);
    }
    expect((await app.inject('/api/accounting/summary?month=2026-08')).json()).toMatchObject({ incomeCents: 10000, expenseCents: 800, netCents: 9200 });
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});
