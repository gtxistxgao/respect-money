import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/server/app.js';
import { readConfig } from '../src/server/config.js';

it('corrects travel income to a refund and includes it in category details and net spending', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'respect-money-refund-'));
  let app = await buildApp({ ...readConfig(), dataDir: directory });
  try {
    const account = (await app.inject({ method: 'POST', url: '/api/accounts/manual', payload: { name: 'Refund fixture', institution: 'Test', type: 'credit' } })).json();
    const base = { accountId: account.id, postedDate: '2026-08-15', category: 'travel', country: 'US' };
    expect((await app.inject({ method: 'POST', url: '/api/transactions/manual', payload: { ...base, description: 'Fictional tickets', amount: '1000.00', kind: 'expense' } })).statusCode).toBe(201);
    const incoming = await app.inject({ method: 'POST', url: '/api/transactions/manual', payload: { ...base, description: 'Fictional ticket refund', amount: '250.00', kind: 'income' } });
    expect(incoming.statusCode).toBe(201);
    const detail = (await app.inject(`/api/transactions/${incoming.json().id}`)).json();
    expect((await app.inject({ method: 'PUT', url: `/api/transactions/${incoming.json().id}/overrides`, payload: { version: detail.version, category: 'travel', kind: 'refund' } })).statusCode).toBe(200);
    await app.close(); app = await buildApp({ ...readConfig(), dataDir: directory });
    const query = `month=2026-08&accounts=${account.id}`;
    const summary = (await app.inject(`/api/accounting/summary?${query}`)).json();
    expect(summary).toMatchObject({ incomeCents: 0, expenseCents: 75000, grossExpenseCents: 100000, refundCents: 25000, categories: [{ category: 'travel', expenseCents: 100000, refundCents: 25000 }] });
    const travel = (await app.inject(`/api/accounting/transactions?${query}&mode=expense&categories=travel`)).json();
    expect(travel).toMatchObject({ total: 2, subtotalCents: 75000 });
    expect(travel.rows.find((row: { kind: string }) => row.kind === 'refund')).toMatchObject({ category: 'travel', cashflowCents: 25000, needsReview: false });
    expect((await app.inject(`/api/accounting/transactions?${query}&mode=income`)).json().total).toBe(0);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

it('lists uncategorized cash flows for review, preserves totals, and removes categorized rows durably', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'respect-money-review-'));
  let app = await buildApp({ ...readConfig(), dataDir: directory });
  try {
    const account = (await app.inject({ method: 'POST', url: '/api/accounts/manual', payload: { name: 'Review fixture', institution: 'Test', type: 'checking' } })).json();
    const ids: Record<string, string> = {};
    for (const kind of ['expense', 'income', 'refund', 'review', 'payment', 'transfer', 'investment', 'reinvestment']) {
      const created = await app.inject({ method: 'POST', url: '/api/transactions/manual', payload: { accountId: account.id, postedDate: '2026-08-02', description: kind, amount: '10.00', kind, category: 'uncategorized', country: 'US' } });
      expect(created.statusCode).toBe(201);
      ids[kind] = created.json().id;
    }
    const query = `month=2026-08&accounts=${account.id}`;
    const review = (await app.inject(`/api/accounting/transactions?${query}&mode=review`)).json();
    expect(review.rows.map((row: { kind: string }) => row.kind).sort()).toEqual(['expense', 'income', 'refund', 'review']);
    expect(review).toMatchObject({ total: 4, subtotalCents: 4000 });
    const totals = { incomeCents: 1000, expenseCents: 0, netCents: 1000 };
    expect((await app.inject(`/api/accounting/summary?${query}`)).json()).toMatchObject({ ...totals, reviewCount: 4, reviewCents: 4000 });
    expect((await app.inject(`/api/accounting/transactions?${query}&mode=review&q=expense`)).json().total).toBe(1);
    expect((await app.inject(`/api/accounting/transactions?month=2026-07&mode=review`)).json().total).toBe(0);
    expect((await app.inject(`/api/accounting/transactions?month=2026-08&accounts=missing&mode=review`)).json().total).toBe(0);
    const detail = (await app.inject(`/api/transactions/${ids.expense}`)).json();
    expect((await app.inject({ method: 'PUT', url: `/api/transactions/${ids.expense}/overrides`, payload: { version: detail.version, category: 'dining' } })).statusCode).toBe(200);
    const refund = (await app.inject(`/api/transactions/${ids.refund}`)).json();
    expect((await app.inject({ method: 'PUT', url: `/api/transactions/${ids.refund}/splits`, payload: { version: refund.version, splits: [
      { cashflowCents: 400, kind: 'refund', category: 'uncategorized', country: 'US', description: 'Uncategorized split' },
      { cashflowCents: 600, kind: 'refund', category: 'dining', country: 'US', description: 'Categorized split' },
    ] } })).statusCode).toBe(200);
    await app.close(); app = await buildApp({ ...readConfig(), dataDir: directory });
    const remaining = (await app.inject(`/api/accounting/transactions?${query}&mode=review`)).json();
    expect(remaining).toMatchObject({ total: 3, subtotalCents: 2400 });
    expect(remaining.rows.map((row: { description: string }) => row.description).sort()).toEqual(['Uncategorized split', 'income', 'review']);
    expect((await app.inject(`/api/accounting/summary?${query}`)).json()).toMatchObject({ ...totals, reviewCount: 3, reviewCents: 2400 });
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

it.each(['salary', 'investments'])('serves durable manual accounting, filters, summaries and guarded edits with %s income', async (incomeCategory) => {
  const directory = await mkdtemp(join(tmpdir(), 'respect-money-api-'));
  let app = await buildApp({ ...readConfig(), dataDir: directory });
  try {
    const account = (await app.inject({ method: 'POST', url: '/api/accounts/manual', payload: { name: 'Test card', institution: 'Chase', mask: '1827', type: 'credit' } })).json();
    const base = { accountId: account.id, postedDate: '2026-08-02', description: 'Lunch', amount: '23.10', kind: 'expense', category: 'dining', country: 'JP' };
    const created = await app.inject({ method: 'POST', url: '/api/transactions/manual', payload: base });
    expect(created.statusCode).toBe(201);
    const income = await app.inject({ method: 'POST', url: '/api/transactions/manual', payload: { ...base, description: 'Income', kind: 'income', amount: '1000', category: incomeCategory } });
    expect(income.statusCode).toBe(201);
    await app.inject({ method: 'POST', url: '/api/transactions/manual', payload: { ...base, description: 'Refund', kind: 'refund', amount: '3.10' } });
    await app.inject({ method: 'POST', url: '/api/transactions/manual', payload: { ...base, description: 'Payment', kind: 'payment', amount: '20' } });
    expect((await app.inject('/api/accounting/summary?month=2026-08')).json()).toMatchObject({ incomeCents: 100000, expenseCents: 2000, netCents: 98000 });
    const filtered = (await app.inject('/api/accounting/transactions?month=2026-08&mode=expense&q=lunch&countries=JP&min=20&max=25')).json();
    expect(filtered.total).toBe(1); expect(filtered.rows[0].description).toBe('Lunch');
    const detail = (await app.inject(`/api/transactions/${created.json().id}`)).json();
    expect(detail.transaction.raw).toBeUndefined();
    const update = { method: 'PUT' as const, url: `/api/transactions/${created.json().id}/overrides`, payload: { version: detail.version, excluded: true } };
    expect((await app.inject(update)).statusCode).toBe(200);
    expect((await app.inject(update)).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/transactions/manual', payload: { ...base, postedDate: '2026-02-30' } })).statusCode).toBe(400);
    await app.close(); app = await buildApp({ ...readConfig(), dataDir: directory });
    expect((await app.inject('/api/accounting/summary?month=2026-08')).json()).toMatchObject({ incomeCents: 100000, expenseCents: -310 });
    const savedIncome = (await app.inject(`/api/accounting/transactions?month=2026-08&mode=income&categories=${incomeCategory}`)).json();
    expect(savedIncome.total).toBe(1);
    expect(savedIncome.rows[0]).toMatchObject({ category: incomeCategory, kind: 'income', cashflowCents: 100000 });
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

it.each(['internal_transfer', 'investment_transaction'] as const)('excludes the %s category and split portions, persists them, and restores income when recategorized', async (category) => {
  const directory = await mkdtemp(join(tmpdir(), 'respect-money-transfer-'));
  let app = await buildApp({ ...readConfig(), dataDir: directory });
  try {
    const account = (await app.inject({ method: 'POST', url: '/api/accounts/manual', payload: { name: 'Transfer fixture', institution: 'Test', type: 'checking' } })).json();
    const base = { accountId: account.id, postedDate: '2026-06-15', country: 'US', notes: 'Preserved note' };
    const incoming = await app.inject({ method: 'POST', url: '/api/transactions/manual', payload: { ...base, description: 'Own account credit', amount: '75.00', kind: 'income', category } });
    expect(incoming.statusCode).toBe(201);
    const incomingId = incoming.json().id;
    const detail = (await app.inject(`/api/transactions/${incomingId}`)).json();
    expect(detail).toMatchObject({ transaction: { kind: 'income', cashflowCents: 7500, category } });
    expect((await app.inject({ method: 'PATCH', url: `/api/transactions/manual/${incomingId}`, payload: { ...base, description: 'Own account credit', amount: '75.00', kind: detail.transaction.kind, category, version: detail.version } })).statusCode).toBe(200);

    const outgoing = await app.inject({ method: 'POST', url: '/api/transactions/manual', payload: { ...base, description: 'Mixed debit', amount: '100.00', kind: 'expense', category: 'shopping' } });
    const outgoingId = outgoing.json().id;
    const outgoingDetail = (await app.inject(`/api/transactions/${outgoingId}`)).json();
    expect((await app.inject({ method: 'PUT', url: `/api/transactions/${outgoingId}/splits`, payload: { version: outgoingDetail.version, splits: [
      { cashflowCents: -7000, category, country: 'US', kind: 'expense', description: 'Transfer portion' },
      { cashflowCents: -3000, category: 'shopping', country: 'US', kind: 'expense', description: 'Purchase portion' },
    ] } })).statusCode).toBe(200);
    await app.close(); app = await buildApp({ ...readConfig(), dataDir: directory });
    const summary = (await app.inject('/api/accounting/summary?month=2026-06')).json();
    expect(summary).toMatchObject({ incomeCents: 0, expenseCents: 3000, netCents: -3000, reviewCount: 0, grossExpenseCents: 3000, categories: [{ category: 'shopping', expenseCents: 3000, refundCents: 0 }] });
    expect((await app.inject(`/api/accounting/overview?accounts=${account.id}`)).json().months[0]).toEqual(summary);
    expect((await app.inject('/api/accounting/transactions?month=2026-06&mode=income')).json().total).toBe(0);
    expect((await app.inject('/api/accounting/transactions?month=2026-06&mode=expense')).json().total).toBe(1);
    const transfers = (await app.inject(`/api/accounting/transactions?month=2026-06&mode=all&categories=${category}`)).json().rows;
    expect(transfers).toHaveLength(2);
    expect(transfers.every((row: { categoryExcluded: boolean; needsReview: boolean }) => row.categoryExcluded && !row.needsReview)).toBe(true);
    expect(transfers.map((row: { cashflowCents: number }) => row.cashflowCents).sort((a: number, b: number) => a - b)).toEqual([-7000, 7500]);
    const latest = (await app.inject(`/api/transactions/${incomingId}`)).json();
    expect((await app.inject({ method: 'PUT', url: `/api/transactions/${incomingId}/overrides`, payload: { version: latest.version, category: 'salary' } })).statusCode).toBe(200);
    expect((await app.inject('/api/accounting/summary?month=2026-06')).json()).toMatchObject({ incomeCents: 7500, expenseCents: 3000 });
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

it('sorts accounts before pagination and intersects account column filters with other filters', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'respect-money-account-column-'));
  const app = await buildApp({ ...readConfig(), dataDir: directory });
  try {
    const accounts: string[] = [];
    for (const [name, mask] of [['Alpha card', '1111'], ['Alpha card', '2222'], ['Zulu card', '9999'], ['Disabled card', '0000']]) {
      const response = await app.inject({ method: 'POST', url: '/api/accounts/manual', payload: { name, mask, institution: 'Fixture bank', type: 'credit' } });
      expect(response.statusCode).toBe(201); accounts.push(response.json().id);
    }
    for (const [index, amount, kind, category] of [[2, '30', 'expense', 'dining'], [1, '3', 'refund', 'travel'], [0, '10', 'expense', 'dining'], [1, '20', 'expense', 'travel'], [0, '15', 'expense', 'travel'], [3, '5', 'expense', 'travel']] as const) {
      expect((await app.inject({ method: 'POST', url: '/api/transactions/manual', payload: { accountId: accounts[index], postedDate: '2026-08-12', description: `Account column fixture ${kind}`, amount, kind, category, country: 'US' } })).statusCode).toBe(201);
    }
    expect((await app.inject({ method: 'PATCH', url: `/api/accounts/${accounts[3]}`, payload: { enabled: false } })).statusCode).toBe(200);
    const rows = async (query: Record<string, string>) => (await app.inject(`/api/accounting/transactions?${new URLSearchParams({ month: '2026-08', mode: 'expense', ...query })}`)).json();
    const ascending = await rows({ sort: 'account', direction: 'asc' });
    expect(ascending.rows.map((row: { accountId: string }) => row.accountId)).toEqual([accounts[0], accounts[0], accounts[1], accounts[1], accounts[2]]);
    expect(ascending).toMatchObject({ total: 5, subtotalCents: 7200 });
    const descending = await rows({ sort: 'account', direction: 'desc' });
    expect(descending.rows.map((row: { accountId: string }) => row.accountId)).toEqual([accounts[2], accounts[1], accounts[1], accounts[0], accounts[0]]);
    const paginated = await rows({ sort: 'account', direction: 'asc', pageSize: '2', page: '2' });
    expect(paginated).toMatchObject({ total: 5, subtotalCents: 7200, page: 2 });
    expect(paginated.rows.map((row: { id: string }) => row.id)).toEqual(ascending.rows.slice(2, 4).map((row: { id: string }) => row.id));
    expect(await rows({ transactionAccounts: `${accounts[0]},${accounts[2]}` })).toMatchObject({ total: 3, subtotalCents: 5500 });
    expect(await rows({ transactionAccounts: `${accounts[0]},${accounts[1]}`, categories: 'travel', min: '14', q: 'expense', countries: 'US' })).toMatchObject({ total: 2, subtotalCents: 3500 });
    const intersection = await rows({ accounts: `${accounts[1]},${accounts[2]}`, transactionAccounts: `${accounts[0]},${accounts[1]}` });
    expect(intersection).toMatchObject({ total: 2, subtotalCents: 1700 });
    expect(intersection.rows.every((row: { accountId: string }) => row.accountId === accounts[1])).toBe(true);
    expect(await rows({ transactionAccounts: accounts[1], mode: 'refund' })).toMatchObject({ total: 1, subtotalCents: 300 });
    for (const id of [accounts[3], 'missing-account']) expect(await rows({ transactionAccounts: id })).toMatchObject({ total: 0, subtotalCents: 0 });
    expect((await app.inject(`/api/accounting/summary?month=2026-08&transactionAccounts=${accounts[0]}`)).json()).toMatchObject({ expenseCents: 7200 });
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

it('changes cash flow types independently, preserves source facts, and updates only the selected split', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'respect-money-inline-kind-'));
  let app = await buildApp({ ...readConfig(), dataDir: directory });
  try {
    const account = (await app.inject({ method: 'POST', url: '/api/accounts/manual', payload: { name: 'Type fixture', institution: 'Test', type: 'cash' } })).json();
    const incoming = (await app.inject({ method: 'POST', url: '/api/transactions/manual', payload: { accountId: account.id, postedDate: '2026-08-12', description: 'Fixture receipt', amount: '200', kind: 'income', category: 'travel', country: 'JP', notes: 'Keep notes' } })).json().id;
    const detail = async () => (await app.inject(`/api/transactions/${incoming}`)).json();
    const summary = async () => (await app.inject('/api/accounting/summary?month=2026-08')).json();
    const original = await detail();
    const update = { method: 'PUT' as const, url: `/api/transactions/${incoming}/overrides`, payload: { version: original.version, kind: 'refund' } };
    expect((await app.inject(update)).statusCode).toBe(200);
    expect((await detail()).transaction).toMatchObject({ sourceHash: original.transaction.sourceHash, category: 'travel', kind: 'refund', cashflowCents: 20000, country: 'JP', notes: 'Keep notes' });
    expect(await summary()).toMatchObject({ incomeCents: 0, expenseCents: -20000, refundCents: 20000 });
    expect((await app.inject(update)).statusCode).toBe(409);
    expect((await app.inject({ ...update, payload: { version: (await detail()).version, kind: 'expense' } })).statusCode).toBe(400);
    await app.close(); app = await buildApp({ ...readConfig(), dataDir: directory });
    expect((await detail()).transaction.kind).toBe('refund');
    const splitUrl = `/api/transactions/${incoming}/splits`;
    expect((await app.inject({ method: 'PUT', url: splitUrl, payload: { version: (await detail()).version, splits: [
      { cashflowCents: 12000, category: 'travel', country: 'JP', kind: 'income', description: 'First portion' },
      { cashflowCents: 8000, category: 'housing', country: 'US', kind: 'income', description: 'Other portion' },
    ] } })).statusCode).toBe(200);
    let latest = await detail();
    const other = latest.override.splits[1];
    let first = { ...latest.override.splits[0], kind: 'refund' };
    expect((await app.inject({ method: 'PUT', url: splitUrl, payload: { version: latest.version, splits: [first, other] } })).statusCode).toBe(200);
    expect(await summary()).toMatchObject({ incomeCents: 8000, expenseCents: -12000, refundCents: 12000 });
    latest = await detail(); first = { ...first, kind: 'review' };
    expect((await app.inject({ method: 'PUT', url: splitUrl, payload: { version: latest.version, splits: [first, other] } })).statusCode).toBe(200);
    expect(await summary()).toMatchObject({ incomeCents: 8000, expenseCents: 0, refundCents: 0, reviewCount: 1, reviewCents: 12000 });
    expect((await detail()).override.splits[1]).toEqual(other);
    latest = await detail();
    expect((await app.inject({ method: 'PUT', url: splitUrl, payload: { version: latest.version, splits: [first, { ...other, kind: 'refund', excluded: true }] } })).statusCode).toBe(200);
    await app.close(); app = await buildApp({ ...readConfig(), dataDir: directory });
    expect(await summary()).toMatchObject({ incomeCents: 0, expenseCents: 0, refundCents: 0, reviewCount: 1 });
    const rows = (await app.inject('/api/accounting/transactions?month=2026-08&mode=all')).json().rows;
    expect(rows.find((row: { description: string }) => row.description === 'Other portion')).toMatchObject({ kind: 'refund', excluded: true, cashflowCents: 8000, category: 'housing' });
    expect((await detail()).transaction.sourceHash).toBe(original.transaction.sourceHash);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
