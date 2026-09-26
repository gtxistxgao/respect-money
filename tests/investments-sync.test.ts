import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { InvestmentTransaction, InvestmentsTransactionsGetResponse } from 'plaid';
import { Repository } from '../src/server/storage/repository.js';
import { syncInvestments } from '../src/server/services/investments-sync.js';
import { fakePlaid } from './fixtures/plaid.js';
import { summarize } from '../src/server/domain/ledger.js';

const tx = (id: string, date: string, amount = -10) => ({ investment_transaction_id: id, account_id: 'investment', security_id: 'fund', name: 'Test cash dividend', amount, date, type: 'cash', subtype: 'dividend', iso_currency_code: 'USD' }) as InvestmentTransaction;
const page = (transactions: InvestmentTransaction[], total = transactions.length) => ({ item: { item_id: 'item' }, accounts: [], securities: [{ security_id: 'fund', name: 'Fictional fund' }], investment_transactions: transactions, total_investment_transactions: total }) as unknown as InvestmentsTransactionsGetResponse;

it('reconciles complete investment ranges, including corrections and removals, without erasing on partial failure', async () => {
  const path = await mkdtemp(join(tmpdir(), 'respect-money-invest-')); const repository = await new Repository(path).initialize();
  try {
    const account = await repository.addAccount({ name: 'Test investment', institution: 'Fidelity', type: 'investment', mask: '0001' });
    await repository.change((s) => { Object.assign(s.accounts[0], { source: 'plaid', itemId: 'item', plaidAccountId: 'investment' }); s.connections.item = { id: 'item', institution: 'Fidelity', products: ['investments'], status: 'connected' }; s.vault.tokens.item = 'test'; });
    const plaid = fakePlaid({ investments: async (_token, _range, offset) => offset ? page([tx('b', '2026-08-02')], 2) : page([tx('a', '2026-07-31')], 2) });
    await syncInvestments(repository, plaid, 'item', [account.id], { start: '2026-01-01', end: '2026-08-31' });
    await repository.change((s) => { s.staleAccountIds = []; });
    expect(summarize(repository.snapshot().processed).incomeCents).toBe(2000);
    plaid.investments = async (_token, _range, offset) => { if (offset) throw new Error('Simulated timeout'); return page([tx('a', '2026-07-30', -15)], 2); };
    await expect(syncInvestments(repository, plaid, 'item', [account.id], { start: '2026-08-01', end: '2026-08-31' })).rejects.toThrow();
    expect(summarize(repository.snapshot().processed).incomeCents).toBe(2000);
    plaid.investments = async (_token, range) => { expect(range.start).toBe('2026-01-01'); return page([tx('a', '2026-07-30', -15)]); };
    await syncInvestments(repository, plaid, 'item', [account.id], { start: '2026-08-01', end: '2026-08-31' });
    await repository.change((s) => { s.staleAccountIds = []; });
    expect(repository.snapshot().processed).toHaveLength(1);
    expect(summarize(repository.snapshot().processed).incomeCents).toBe(1500);
    expect(Object.values(repository.snapshot().records)[0].payload._security).toMatchObject({ name: 'Fictional fund' });
    const historical = { accountId: account.id, source: 'plaid_investments' as const, payload: { ...tx('archived', '2020-01-01', -100) } };
    await repository.importRecords([historical], { [account.id]: [{ start: '2020-01-01', end: '2020-01-31' }] });
    await syncInvestments(repository, plaid, 'item', [account.id], { start: '2026-08-01', end: '2026-08-31' });
    expect(Object.values(repository.snapshot().records).some((r) => r.payload.investment_transaction_id === 'archived')).toBe(true);
  } finally { await repository.close(); await rm(path, { recursive: true, force: true }); }
});
