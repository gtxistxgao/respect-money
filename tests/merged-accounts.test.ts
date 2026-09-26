import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Repository } from '../src/server/storage/repository.js';
import { reconcileAccounts } from '../src/server/services/connections.js';
import { syncTransactions } from '../src/server/services/transactions-sync.js';
import { WealthService } from '../src/server/services/wealth.js';
import { emptyState } from '../src/server/storage/state.js';
import { bankAccount, fakePlaid, syncPage, transaction } from './fixtures/plaid.js';

it('remembers explicit merges across restarts, balance refreshes and transaction syncs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'respect-money-merged-'));
  const repo = await new Repository(dir).initialize();
  const bank = { ...bankAccount, balances: { ...bankAccount.balances, current: 1000, iso_currency_code: 'USD' } };
  const duplicate = { ...bankAccount, account_id: 'duplicate-bank' };
  const investment = { ...bankAccount, account_id: 'investment', type: 'investment', subtype: 'brokerage', name: 'Brokerage', mask: '9876', balances: { ...bank.balances, current: 500 } } as typeof bankAccount;
  const plaid = fakePlaid({
    accounts: async (token) => ({ item: { item_id: token }, accounts: token === 'original' ? [bank] : [duplicate, investment], request_id: 'fixture' }) as Awaited<ReturnType<ReturnType<typeof fakePlaid>['accounts']>>,
    sync: async (token) => syncPage('cursor', [{ ...transaction(token), account_id: token === 'original' ? bankAccount.account_id : duplicate.account_id }], { accounts: token === 'original' ? [bankAccount] : [duplicate] }),
  });
  try {
    await repo.change((state) => {
      state.connections.original = { id: 'original', institution: 'Fixture', products: ['transactions'], status: 'connected' };
      state.connections.secondary = { id: 'secondary', institution: 'Fixture', products: ['transactions'], status: 'connected' };
      state.vault.tokens = { original: 'original', secondary: 'secondary' };
      reconcileAccounts(state, 'original', [bankAccount], [bankAccount.account_id]);
      state.connections.secondary.mergedAccounts = { [duplicate.account_id]: state.accounts[0].id };
    }, false);
    const original = repo.snapshot().accounts[0];
    await repo.close(); await repo.initialize();
    const wealth = new WealthService(repo, plaid);
    for (let attempt = 0; attempt < 2; attempt++) {
      wealth.refresh(); await wealth.close();
      for (const itemId of ['original', 'secondary']) await syncTransactions(repo, plaid, itemId, [original.id], { start: '2026-08-01', end: '2026-08-31' });
    }
    const state = repo.snapshot();
    expect(state.accounts).toHaveLength(2);
    expect(state.accounts[0]).toEqual(original);
    expect(state.accounts[1]).toMatchObject({ itemId: 'secondary', plaidAccountId: investment.account_id });
    expect(Object.values(state.records)).toHaveLength(1);
    expect(Object.values(state.records)[0].accountId).toBe(original.id);
    expect(wealth.summary().accounts).toHaveLength(2);
    expect(wealth.summary().assetsCents).toBe(150000);
    expect(wealth.summary().errors).toEqual([]);
  } finally { await repo.close(); await rm(dir, { recursive: true, force: true }); }
});

it('does not infer merges from names or masks and discovers the account if its retained source is gone', () => {
  const state = emptyState();
  state.connections.original = { id: 'original', institution: 'Fixture', products: [], status: 'connected' };
  state.connections.secondary = { id: 'secondary', institution: 'Fixture', products: [], status: 'connected' };
  reconcileAccounts(state, 'original', [bankAccount]);
  const duplicate = { ...bankAccount, account_id: 'duplicate-bank' };
  reconcileAccounts(state, 'secondary', [duplicate]);
  expect(state.accounts).toHaveLength(2);
  state.connections.secondary.mergedAccounts = { [duplicate.account_id]: state.accounts[0].id };
  state.accounts = state.accounts.slice(0, 1);
  reconcileAccounts(state, 'secondary', [duplicate]);
  expect(state.accounts).toHaveLength(1);
  delete state.connections.original;
  reconcileAccounts(state, 'secondary', [duplicate]);
  expect(state.accounts).toHaveLength(2);
});
