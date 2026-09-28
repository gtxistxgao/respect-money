import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { readConfig } from '../src/server/config.js';
import { Repository } from '../src/server/storage/repository.js';
import { defaultCategories, type CategoryDefinition } from '../src/shared/categories.js';
import { createClassifier, validateClassifications } from '../src/server/integrations/codex/classifier.js';
import { ClassificationService } from '../src/server/services/classification.js';
import { normalize, summarize } from '../src/server/domain/ledger.js';

it('configures neutral categories, independent cash flows, refunds and inclusion durably', async () => {
  const root = await mkdtemp(join(tmpdir(), 'respect-categories-'));
  let app = await buildApp(readConfig(root));
  try {
    const catalog = (await app.inject('/api/categories')).json();
    expect(catalog.categories.find((row: CategoryDefinition) => row.id === 'side_business')).toMatchObject({ name: 'Side business', includeInCashflow: true });
    const value = { name: 'Studio', prompt: 'Freelance studio receipts, supplies and returned purchases.', includeInCashflow: true };
    const added = await app.inject({ method: 'POST', url: '/api/categories', payload: { ...value, revision: catalog.revision } });
    expect(added.statusCode).toBe(201);
    let current = added.json();
    const category = current.categories.at(-1).id;
    expect((await app.inject({ method: 'POST', url: '/api/categories', payload: { ...value, revision: current.revision } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: `/api/categories/${category}`, payload: { ...value, revision: catalog.revision } })).statusCode).toBe(409);
    const account = (await app.inject({ method: 'POST', url: '/api/accounts/manual', payload: { name: 'Fixture', institution: 'Fixture', type: 'cash' } })).json();
    const base = { accountId: account.id, postedDate: '2026-08-01', category, description: 'Studio fixture' };
    const ids: string[] = [];
    for (const [kind, amount] of [['income', '100'], ['expense', '40'], ['refund', '10']]) {
      const created = await app.inject({ method: 'POST', url: '/api/transactions/manual', payload: { ...base, kind, amount } });
      expect(created.statusCode).toBe(201); ids.push(created.json().id);
    }
    const query = 'month=2026-08';
    expect((await app.inject(`/api/accounting/summary?${query}`)).json()).toMatchObject({ incomeCents: 10000, expenseCents: 3000, refundCents: 1000, netCents: 7000, categories: [{ category, expenseCents: 4000, refundCents: 1000 }] });
    expect((await app.inject(`/api/accounting/transactions?${query}&mode=refund`)).json()).toMatchObject({ total: 1, subtotalCents: 1000, rows: [{ kind: 'refund', category }] });
    const excluded = await app.inject({ method: 'PUT', url: `/api/categories/${category}`, payload: { ...value, name: 'Renamed studio', includeInCashflow: false, revision: current.revision } });
    expect(excluded.statusCode).toBe(200); current = excluded.json();
    expect((await app.inject(`/api/accounting/summary?${query}`)).json()).toMatchObject({ incomeCents: 0, expenseCents: 0, refundCents: 0 });
    for (const mode of ['income', 'expense', 'refund']) expect((await app.inject(`/api/accounting/transactions?${query}&mode=${mode}`)).json().total).toBe(0);
    const all = (await app.inject(`/api/accounting/transactions?${query}&mode=all`)).json().rows;
    expect(all.map((row: { kind: string }) => row.kind).sort()).toEqual(['expense', 'income', 'refund']);
    expect(all.every((row: { categoryExcluded: boolean; excluded: boolean }) => row.categoryExcluded && !row.excluded)).toBe(true);
    const refund = (await app.inject(`/api/transactions/${ids[2]}`)).json();
    expect((await app.inject({ method: 'PUT', url: `/api/transactions/${ids[2]}/overrides`, payload: { version: refund.version, category: 'travel' } })).statusCode).toBe(200);
    expect((await app.inject(`/api/accounting/summary?${query}`)).json()).toMatchObject({ incomeCents: 0, expenseCents: -1000, refundCents: 1000 });
    expect((await app.inject({ method: 'POST', url: '/api/transactions/manual', payload: { ...base, category: 'missing', kind: 'expense', amount: '1' } })).statusCode).toBe(400);
    await app.close(); app = await buildApp(readConfig(root));
    expect((await app.inject('/api/categories')).json()).toEqual(current);
    expect((await app.inject(`/api/transactions/${ids[2]}`)).json().transaction).toMatchObject({ category: 'travel', kind: 'refund', cashflowCents: 1000 });
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});

it('deletes categories atomically across stale published rows, splits, caches, rules and source redirects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'respect-delete-category-'));
  let app = await buildApp(readConfig(root));
  let repository: Repository | undefined;
  try {
    await app.close();
    repository = await new Repository(root).initialize();
    const account = await repository.addAccount({ name: 'Fixture', institution: 'Fixture', type: 'cash', mask: '' });
    const base = { accountId: account.id, description: 'Fixture', postedDate: '2026-08-01', category: 'travel', country: 'US', notes: '' };
    const income = await repository.addManual({ ...base, kind: 'income', amount: '100' });
    const split = await repository.addManual({ ...base, kind: 'expense', amount: '40' });
    const refund = await repository.addManual({ ...base, kind: 'refund', amount: '10' });
    await repository.editOverride(split, repository.version(repository.snapshot(), split), { splits: [
      { cashflowCents: -3000, category: 'travel', kind: 'expense', description: 'Travel portion', country: 'US' },
      { cashflowCents: -1000, category: 'dining', kind: 'expense', description: 'Dinner', country: 'US' },
    ] });
    await repository.change(state => {
      state.reclassificationRules = [{ id: '33333333-3333-4333-8333-333333333333', revision: 1, category: 'travel', example: 'Fictional studio', direction: 'all' }];
      state.classifications[refund] = { sourceHash: normalize(state.records[refund]).sourceHash, kind: 'refund', category: 'travel', country: 'US', countrySource: 'default', needsReview: false, reason: '', classifierVersion: 'fixture', classifiedAt: '2026-08-01' };
      state.staleAccountIds = [account.id];
    }, false);
    const before = repository.snapshot();
    await repository.close(); repository = undefined;
    app = await buildApp(readConfig(root));
    let catalog = (await app.inject('/api/categories')).json();
    const travel = catalog.categories.find((row: CategoryDefinition) => row.id === 'travel');
    const { id: travelId, ...travelFields } = travel;
    const excluded = await app.inject({ method: 'PUT', url: `/api/categories/${travelId}`, payload: { ...travelFields, includeInCashflow: false, revision: catalog.revision } });
    expect(excluded.statusCode).toBe(200); catalog = excluded.json();
    expect((await app.inject('/api/accounting/summary?month=2026-08')).json()).toMatchObject({ incomeCents: 0, expenseCents: 1000, refundCents: 0, stale: true });
    expect((await app.inject({ method: 'DELETE', url: '/api/categories/uncategorized', payload: { revision: catalog.revision, replacement: 'dining' } })).statusCode).toBe(400);
    const removed = await app.inject({ method: 'DELETE', url: '/api/categories/travel', payload: { revision: catalog.revision, replacement: 'side_business' } });
    expect(removed.statusCode).toBe(200); catalog = removed.json();
    expect(catalog.categories.some((row: CategoryDefinition) => row.id === 'travel')).toBe(false);
    const detail = (await app.inject(`/api/transactions/${income}`)).json();
    expect(detail.transaction).toMatchObject({ category: 'side_business', kind: 'income', cashflowCents: 10000 });
    const list = (await app.inject('/api/accounting/transactions?month=2026-08&mode=all')).json().rows;
    expect(list.find((row: { id: string }) => row.id === income).version).toBe(detail.version);
    expect(list.filter((row: { category: string }) => row.category === 'side_business')).toHaveLength(3);
    expect((await app.inject('/api/reclassification/rules')).json()[0]).toMatchObject({ category: 'side_business', revision: 2 });
    await app.close();
    repository = await new Repository(root).initialize();
    expect(repository.snapshot().records).toEqual(before.records);
    expect(repository.snapshot().classifications[refund].category).toBe('side_business');
    expect(repository.snapshot().staleAccountIds).toEqual([account.id]);
    await repository.change(state => { state.staleAccountIds = []; });
    const after = repository.snapshot();
    expect(summarize(after.processed)).toEqual(summarize(before.processed));
    expect(after.processed.some(row => row.category === 'travel')).toBe(false);
    expect(after.records).toEqual(before.records);
  } finally { await repository?.close(); await app.close(); await rm(root, { recursive: true, force: true }); }
});

it.each(['codex', 'claude'] as const)('uses configured categories and prompts with %s and validates dynamic IDs', async provider => {
  const root = await mkdtemp(join(tmpdir(), 'respect-category-ai-'));
  const repository = await new Repository(root).initialize();
  try {
    const category = { id: 'custom_studio', name: 'Studio', prompt: 'Use for Fictional Studio receipts, purchases and refunds.', includeInCashflow: true };
    const definitions = [...defaultCategories, category];
    const account = await repository.addAccount({ name: 'Fixture', institution: 'Fixture', type: 'cash', mask: '' });
    const { dataDir, ...settings } = readConfig(root); void dataDir;
    await repository.change(state => { state.settings = { ...settings, categoryDefinitions: definitions }; });
    await repository.addManual({ accountId: account.id, description: 'Fictional Studio purchase', postedDate: '2026-08-01', kind: 'expense', category: 'uncategorized', amount: '10', country: 'US', notes: '' });
    const run = vi.fn(async (_prompt: string, _schema: object) => { void _prompt; void _schema; return ({ classifications: [{ ref: 'r0', kind: 'expense', category: category.id, country: 'US', reason: 'Studio purchase', needsReview: false }] }); });
    const classifier = createClassifier({ bin: provider, timeoutMs: 1000 }, undefined, run, definitions);
    const result = await new ClassificationService(repository, classifier, 'fixture', provider).publish([account.id], false, async () => undefined);
    expect(result).toMatchObject({ failed: 0, total: 1 });
    expect(repository.snapshot().processed[0]).toMatchObject({ category: category.id, kind: 'expense', classificationSource: provider });
    expect(run.mock.calls[0][0]).toContain(category.prompt);
    expect(run.mock.calls[0][1]).toMatchObject({ properties: { classifications: { items: { properties: { category: { enum: definitions.map(row => row.id) }, kind: { enum: ['income', 'expense', 'refund', 'review'] } } } } } });
    const inputs = [{ ref: 'r0', cashflowCents: -1000 }] as Parameters<typeof validateClassifications>[1];
    expect(() => validateClassifications({ classifications: [{ ref: 'r0', kind: 'expense', category: 'missing', country: 'US', reason: '', needsReview: false }] }, inputs, definitions)).toThrow('unknown category');
  } finally { await repository.close(); await rm(root, { recursive: true, force: true }); }
});

it('preserves previously confirmed legacy categories and types when publishing again', async () => {
  const root = await mkdtemp(join(tmpdir(), 'respect-category-upgrade-'));
  let repository = await new Repository(root).initialize();
  try {
    const account = await repository.addAccount({ name: 'Fixture', institution: 'Fixture', type: 'cash', mask: '' });
    const id = await repository.addManual({ accountId: account.id, description: 'Fixture legacy review', postedDate: '2026-08-01', kind: 'review', category: 'uncategorized', amount: '10', country: 'US', notes: '' });
    await repository.editOverride(id, repository.version(repository.snapshot(), id), { category: 'side_business' });
    await repository.change(state => {
      state.overrides[id].category = 'side_business_expenses';
      const row = state.processed[0];
      Object.assign(row, { category: 'side_business_expenses', kind: 'expense', needsReview: false });
      delete row.categoryExcluded; // Snapshot published by the legacy app.
    }, false);
    const raw = repository.snapshot().records;
    await repository.close(); repository = await new Repository(root).initialize();
    expect(repository.snapshot().overrides[id]).toMatchObject({ category: 'side_business', kind: 'expense' });
    await repository.change(() => undefined);
    expect(repository.snapshot().processed[0]).toMatchObject({ category: 'side_business', kind: 'expense', needsReview: false, cashflowCents: -1000 });
    expect(repository.snapshot().records).toEqual(raw);
    const before = repository.snapshot();
    await repository.close(); repository = await new Repository(root).initialize();
    expect(repository.snapshot()).toEqual(before);
  } finally { await repository.close(); await rm(root, { recursive: true, force: true }); }
});
