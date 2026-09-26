import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/server/app.js';
import { readConfig } from '../src/server/config.js';

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

it('excludes the internal transfer category and split portions, persists them, and restores income when recategorized', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'respect-money-transfer-'));
  let app = await buildApp({ ...readConfig(), dataDir: directory });
  try {
    const account = (await app.inject({ method: 'POST', url: '/api/accounts/manual', payload: { name: 'Transfer fixture', institution: 'Test', type: 'checking' } })).json();
    const base = { accountId: account.id, postedDate: '2026-06-15', country: 'US', notes: 'Preserved note' };
    const incoming = await app.inject({ method: 'POST', url: '/api/transactions/manual', payload: { ...base, description: 'Own account credit', amount: '75.00', kind: 'income', category: 'internal_transfer' } });
    expect(incoming.statusCode).toBe(201);
    const incomingId = incoming.json().id;
    const detail = (await app.inject(`/api/transactions/${incomingId}`)).json();
    expect(detail).toMatchObject({ editableKind: 'income', transaction: { kind: 'transfer', cashflowCents: 7500, category: 'internal_transfer' } });
    expect((await app.inject({ method: 'PATCH', url: `/api/transactions/manual/${incomingId}`, payload: { ...base, description: 'Own account credit', amount: '75.00', kind: detail.editableKind, category: 'internal_transfer', version: detail.version } })).statusCode).toBe(200);

    const outgoing = await app.inject({ method: 'POST', url: '/api/transactions/manual', payload: { ...base, description: 'Mixed debit', amount: '100.00', kind: 'expense', category: 'shopping' } });
    const outgoingId = outgoing.json().id;
    const outgoingDetail = (await app.inject(`/api/transactions/${outgoingId}`)).json();
    expect((await app.inject({ method: 'PUT', url: `/api/transactions/${outgoingId}/splits`, payload: { version: outgoingDetail.version, splits: [
      { cashflowCents: -7000, category: 'internal_transfer', country: 'US', kind: 'expense', description: 'Transfer portion' },
      { cashflowCents: -3000, category: 'shopping', country: 'US', kind: 'expense', description: 'Purchase portion' },
    ] } })).statusCode).toBe(200);
    await app.close(); app = await buildApp({ ...readConfig(), dataDir: directory });
    const summary = (await app.inject('/api/accounting/summary?month=2026-06')).json();
    expect(summary).toMatchObject({ incomeCents: 0, expenseCents: 3000, netCents: -3000, reviewCount: 0, grossExpenseCents: 3000, categories: [{ category: 'shopping', expenseCents: 3000, refundCents: 0 }] });
    expect((await app.inject(`/api/accounting/overview?accounts=${account.id}`)).json().months[0]).toEqual(summary);
    expect((await app.inject('/api/accounting/transactions?month=2026-06&mode=income')).json().total).toBe(0);
    expect((await app.inject('/api/accounting/transactions?month=2026-06&mode=expense')).json().total).toBe(1);
    const transfers = (await app.inject('/api/accounting/transactions?month=2026-06&mode=all&categories=internal_transfer')).json().rows;
    expect(transfers).toHaveLength(2);
    expect(transfers.every((row: { kind: string; needsReview: boolean }) => row.kind === 'transfer' && !row.needsReview)).toBe(true);
    expect(transfers.map((row: { cashflowCents: number }) => row.cashflowCents).sort((a: number, b: number) => a - b)).toEqual([-7000, 7500]);
    const latest = (await app.inject(`/api/transactions/${incomingId}`)).json();
    expect((await app.inject({ method: 'PUT', url: `/api/transactions/${incomingId}/overrides`, payload: { version: latest.version, category: 'salary' } })).statusCode).toBe(200);
    expect((await app.inject('/api/accounting/summary?month=2026-06')).json()).toMatchObject({ incomeCents: 7500, expenseCents: 3000 });
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
