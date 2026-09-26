import { wealthBreakdown } from '../src/shared/wealth-breakdown.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { AccountBase, InvestmentsHoldingsGetResponse } from 'plaid';
import { accountBalance, wealthSummary } from '../src/server/domain/wealth.js';
import { emptyState } from '../src/server/storage/state.js';
import { Repository } from '../src/server/storage/repository.js';
import { WealthService } from '../src/server/services/wealth.js';
import { buildApp } from '../src/server/app.js';
import { readConfig } from '../src/server/config.js';
import { emptyWealth, type WealthSummary } from '../src/shared/wealth.js';
import { fakePlaid } from './fixtures/plaid.js';
import { reconcileAccounts } from '../src/server/services/connections.js';
import type { PlaidGateway } from '../src/server/integrations/plaid/client.js';
import { PlaidFailure } from '../src/server/integrations/plaid/client.js';

const stamp = '2026-01-01T12:00:00Z';
function bank(id: string, type: `${AccountBase['type']}`, current: number | null, currency = 'USD'): AccountBase {
  return { account_id: id, name: `Fixture ${id}`, mask: '1234', type, subtype: null, balances: { current, available: 1, limit: null, iso_currency_code: currency, unofficial_currency_code: null } } as AccountBase;
}
function positions(account: AccountBase, values: [string, number][] = [['equity', 700], ['etf', 200], ['cash', 100]]): InvestmentsHoldingsGetResponse {
  return { accounts: [account], item: { item_id: 'item' }, holdings: values.map(([, value], index) => ({ account_id: account.account_id, security_id: String(index), institution_value: value, iso_currency_code: 'USD' })), securities: values.map(([type], index) => ({ security_id: String(index), type, is_cash_equivalent: type === 'cash' })) } as InvestmentsHoldingsGetResponse;
}
const sources = [bank('checking', 'depository', 500), bank('stocks', 'investment', 1000), bank('mortgage', 'loan', 600), bank('credit', 'credit', 20)];
function fixtureState() {
  const state = emptyState(); state.wealth = emptyWealth();
  state.connections.item = { id: 'item', institution: 'Fixture', products: ['investments'], status: 'connected' };
  state.vault.tokens.item = 'synthetic-private-token';
  reconcileAccounts(state, 'item', sources);
  for (const account of state.accounts) {
    const source = sources.find((row) => row.account_id === account.plaidAccountId)!;
    state.wealth.balances[account.id] = accountBalance(source, stamp, source.type === 'investment' ? positions(source) : undefined);
  }
  return state;
}
const home = { name: 'Fixture home', kind: 'property' as const, valueCents: 100000, debtCents: 40000, address: '123 Example Street', vehicleModel: '', valuationDate: '2026-01-01', debtAccountId: null };

it('uses total balances, splits holdings without double counting, and subtracts a linked mortgage once', () => {
  const state = fixtureState();
  const mortgage = state.accounts.find((account) => account.plaidAccountId === 'mortgage')!;
  state.wealth!.assets.push({ ...home, id: 'home', revision: 0, debtCents: 0, debtAccountId: mortgage.id });
  const summary = wealthSummary(state);
  expect(summary).toMatchObject({ assetsCents: 250000, debtsCents: 62000, netWorthCents: 188000, missingAccounts: 0 });
  expect(summary.assets[0]).toMatchObject({ effectiveDebtCents: 60000, equityCents: 40000 });
  expect(summary.allocation.find((part) => part.kind === 'stocks')!.valueCents).toBe(70000);
  expect(summary.allocation.find((part) => part.kind === 'stocks')!.percent).toBeCloseTo(28);
  expect(summary.allocation.reduce((total, part) => total + part.valueCents, 0)).toBe(summary.assetsCents);
  // Accounts disabled in Accounting still belong in Wealth.
  expect(state.accounts.every((account) => !account.enabled)).toBe(true);
  state.wealth!.excludedAccountIds.push(state.accounts.find((account) => account.plaidAccountId === 'stocks')!.id);
  expect(wealthSummary(state).netWorthCents).toBe(188000);
  expect(wealthSummary(state).accounts.every((account) => account.included)).toBe(true);
});

it('handles overdrafts, credit overpayments, unknown currencies and incomplete investment positions honestly', () => {
  expect(accountBalance(bank('checking', 'depository', -5), stamp).netCents).toBe(-500);
  expect(accountBalance(bank('card', 'credit', -20), stamp)).toMatchObject({ netCents: 2000, allocation: [{ kind: 'cash', valueCents: 2000 }] });
  const investment = bank('stocks', 'investment', 1000);
  for (const values of [[['equity', 1200]], [['equity', -100]], []] as [string, number][][]) {
    expect(accountBalance(investment, stamp, positions(investment, values))).toMatchObject({ allocation: [{ kind: 'investment', valueCents: 100000 }], allocationIncomplete: true });
  }
  const partial = accountBalance(investment, stamp, positions(investment, [['equity', 500]]));
  expect(partial.allocation).toEqual([{ kind: 'stocks', valueCents: 50000 }, { kind: 'investment', valueCents: 50000 }]);
  const foreign = positions(investment); foreign.holdings[0].iso_currency_code = 'CAD';
  expect(accountBalance(investment, stamp, foreign).allocation[0].kind).toBe('investment');
  const state = fixtureState();
  state.wealth!.balances[state.accounts[0].id] = accountBalance(bank('checking', 'depository', null), stamp);
  state.wealth!.balances[state.accounts[1].id] = accountBalance(bank('stocks', 'investment', 1000, 'CAD'), stamp);
  expect(wealthSummary(state)).toMatchObject({ assetsCents: 0, debtsCents: 62000, netWorthCents: -62000, missingAccounts: 2 });
});

it('refreshes balances once per connection, retains successful data on failure and never republishes transactions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'respect-money-wealth-'));
  const repo = await new Repository(directory).initialize();
  const state = fixtureState(); await repo.change((draft) => { Object.assign(draft, { ...state, revision: draft.revision }); }, false);
  const manual = await repo.addAccount({ name: 'Fixture cash', institution: 'Fixture', type: 'cash', mask: '' });
  const recordId = await repo.addManual({ accountId: manual.id, postedDate: '2026-01-01', description: 'Published description', amount: '10', kind: 'expense', category: 'dining', country: 'US', notes: '' });
  await repo.change((draft) => { draft.records[recordId].payload.description = 'Unpublished description'; }, false);
  const ledgerSnapshot = repo.snapshot();
  expect(ledgerSnapshot.processed[0].description).toBe('Published description');
  let fail = false; let calls = 0;
  const plaid = fakePlaid({ accounts: async () => { calls++; if (fail) throw new PlaidFailure('ITEM_LOGIN_REQUIRED'); return { accounts: sources, item: { item_id: 'item' } } as Awaited<ReturnType<PlaidGateway['accounts']>>; }, holdings: async () => positions(sources[1]) });
  const service = new WealthService(repo, plaid);
  try {
    service.refresh(); service.refresh(); await service.close();
    expect(calls).toBe(1); expect(service.summary().refreshing).toBe(false); expect(service.summary().errors).toEqual([]);
    expect(service.summary().assetsCents).toBe(150000);
    fail = true; service.refresh(); await service.close();
    expect(service.summary().assetsCents).toBe(150000); expect(service.summary().errors).toHaveLength(1);
    expect(repo.snapshot().records).toEqual(ledgerSnapshot.records); expect(repo.snapshot().processed).toEqual(ledgerSnapshot.processed); expect(repo.snapshot().classifications).toEqual(ledgerSnapshot.classifications);
    expect(JSON.stringify(service.summary())).not.toContain('synthetic-private-token');
  } finally { await service.close(); await repo.close(); await rm(directory, { recursive: true, force: true }); }
});

it('keeps account totals if holdings fail and drops balances for accounts no longer returned by the bank', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'respect-money-wealth-partial-'));
  const repo = await new Repository(directory).initialize();
  await repo.change((draft) => { const state = fixtureState(); Object.assign(draft, { ...state, revision: draft.revision }); }, false);
  const service = new WealthService(repo, fakePlaid({ accounts: async () => ({ accounts: [sources[1]], item: { item_id: 'item' } }) as Awaited<ReturnType<PlaidGateway['accounts']>> }));
  try {
    service.refresh(); await service.close();
    expect(service.summary()).toMatchObject({ assetsCents: 100000, missingAccounts: 3, needsRefresh: false });
    expect(service.summary().errors).toHaveLength(1);
    expect(service.summary().allocation).toEqual([{ kind: 'investment', valueCents: 100000, percent: 100 }]);
  } finally { await repo.close(); await rm(directory, { recursive: true, force: true }); }
});

it('persists assets and edits, validates money and mortgage links, and rejects stale edits and removals', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'respect-money-wealth-api-'));
  const repo = await new Repository(directory).initialize();
  const state = fixtureState(); await repo.change((draft) => { Object.assign(draft, { ...state, revision: draft.revision }); }, false); await repo.close();
  const config = readConfig(directory);
  let app = await buildApp(config, { plaid: fakePlaid() });
  try {
    const mortgageId = state.accounts.find((account) => account.plaidAccountId === 'mortgage')!.id;
    const linkedHome = { ...home, debtCents: 0, debtAccountId: mortgageId };
    const created = await app.inject({ method: 'POST', url: '/api/wealth/assets', payload: linkedHome });
    expect(created.statusCode).toBe(201); const id = created.json().id;
    expect((await app.inject({ method: 'POST', url: '/api/wealth/assets', payload: linkedHome })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: `/api/wealth/accounts/${mortgageId}`, payload: { included: false } })).statusCode).toBe(404);
    for (const patch of [{ valueCents: -1 }, { valueCents: 1.5 }, { valueCents: 1e15 }, { valuationDate: '2026-02-30' }, { valuationDate: '2099-01-01' }, { debtAccountId: 'missing', debtCents: 0 }, { debtAccountId: mortgageId, debtCents: 100 }, { name: ' ' }]) {
      expect((await app.inject({ method: 'POST', url: '/api/wealth/assets', payload: { ...home, ...patch } })).statusCode).toBe(400);
    }
    const updated = await app.inject({ method: 'PUT', url: `/api/wealth/assets/${id}`, payload: { ...home, revision: 0, valueCents: 30000, debtCents: 40000 } });
    expect(updated.statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: `/api/wealth/assets/${id}`, payload: { ...home, revision: 0 } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: `/api/wealth/assets/${id}`, payload: { revision: 0 } })).statusCode).toBe(409);
    await app.close(); app = await buildApp(config, { plaid: fakePlaid() });
    const summary = (await app.inject('/api/wealth')).json<WealthSummary>();
    expect(summary.assets[0]).toMatchObject({ id, revision: 1, valueCents: 30000, effectiveDebtCents: 40000, equityCents: -10000 });
    expect(summary.netWorthCents).toBe(78000);
    expect((await app.inject({ method: 'DELETE', url: `/api/wealth/assets/${id}`, payload: { revision: 1 } })).statusCode).toBe(200);
    expect((await app.inject('/api/wealth')).json().assets).toEqual([]);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});


it('reconciles asset and debt details with totals without double-counting linked mortgages', () => {
  const state = fixtureState();
  const mortgage = state.accounts.find(account => account.plaidAccountId === 'mortgage')!;
  state.wealth!.assets.push({ ...home, id: 'home', revision: 0, debtCents: 0, debtAccountId: mortgage.id });
  state.wealth!.assets.push({ ...home, id: 'car', name: 'Fixture car', kind: 'vehicle', revision: 0, valueCents: 25000, debtCents: 5000 });
  const summary = wealthSummary(state);
  const details = wealthBreakdown(summary);
  expect(details.assets.reduce((sum, row) => sum + row.valueCents, 0)).toBe(summary.assetsCents);
  expect(details.debts.reduce((sum, row) => sum + row.valueCents, 0)).toBe(summary.debtsCents);
  expect(details.debts.filter(row => row.kind === 'mortgage')).toEqual([expect.objectContaining({ id: mortgage.id, valueCents: 60000, linkedAsset: 'Fixture home' })]);
  expect(details.debtAllocation).toEqual([
    { kind: 'mortgage', valueCents: 60000, percent: 60000 / 67000 * 100 },
    { kind: 'vehicle_loan', valueCents: 5000, percent: 5000 / 67000 * 100 },
    { kind: 'credit', valueCents: 2000, percent: 2000 / 67000 * 100 },
  ]);
  for (const part of details.assetAllocation) expect(details.assets.filter(row => row.kind === part.kind).reduce((sum, row) => sum + row.valueCents, 0)).toBe(part.valueCents);
});

it('excludes missing and foreign balances and treats credit overpayments as assets and overdrafts as debt', () => {
  const state = fixtureState();
  for (const account of state.accounts) {
    const balance = state.wealth!.balances[account.id];
    if (account.plaidAccountId === 'checking') Object.assign(balance, { netCents: -1000, allocation: [] });
    if (account.plaidAccountId === 'credit') Object.assign(balance, { netCents: 3000, allocation: [{ kind: 'cash', valueCents: 3000 }] });
    if (account.plaidAccountId === 'mortgage') balance.netCents = null;
    if (account.plaidAccountId === 'stocks') balance.currency = 'CNY';
  }
  const summary = wealthSummary(state);
  const details = wealthBreakdown(summary);
  expect(details.assets).toHaveLength(1); expect(details.assets[0].valueCents).toBe(summary.assetsCents);
  expect(details.debts).toHaveLength(1); expect(details.debts[0]).toMatchObject({ kind: 'overdraft', valueCents: summary.debtsCents });
  expect(wealthBreakdown({ accounts: [], assets: [] })).toEqual({ assets: [], debts: [], assetAllocation: [], debtAllocation: [] });
});


it('groups full balances by account type regardless of missing or partial holdings', () => {
  const state = fixtureState();
  const investment = state.accounts.find(account => account.type === 'investment')!;
  const savings = { ...investment, id: 'savings', name: 'Savings', type: 'savings' as const };
  const secondInvestment = { ...investment, id: 'second-investment', name: 'Second investment' };
  const unknown = { ...investment, id: 'unknown', name: 'Unknown', type: 'other' as const };
  state.accounts.push(savings, secondInvestment, unknown);
  state.wealth!.balances[savings.id] = { ...state.wealth!.balances[investment.id], netCents: 20000, allocation: [{ kind: 'cash', valueCents: 20000 }] };
  state.wealth!.balances[secondInvestment.id] = accountBalance(bank('second', 'investment', 300), stamp);
  state.wealth!.balances[unknown.id] = { ...state.wealth!.balances[savings.id], netCents: 10000, allocation: [{ kind: 'other', valueCents: 10000 }] };
  state.wealth!.assets.push({ ...home, id: 'home', revision: 0 });
  const summary = wealthSummary(state);
  // The displayed distribution must not depend on cached security-level allocations.
  for (const account of summary.accounts) if (account.balance) account.balance.allocation = [];
  const details = wealthBreakdown(summary);
  expect(details.assetAllocation).toEqual([
    { kind: 'account_investment', valueCents: 130000, percent: 130000 / 310000 * 100 },
    { kind: 'property', valueCents: 100000, percent: 100000 / 310000 * 100 },
    { kind: 'account_checking', valueCents: 50000, percent: 50000 / 310000 * 100 },
    { kind: 'account_savings', valueCents: 20000, percent: 20000 / 310000 * 100 },
    { kind: 'account_other', valueCents: 10000, percent: 10000 / 310000 * 100 },
  ]);
  expect(details.assets.filter(row => row.kind === 'account_investment')).toHaveLength(2);
  expect(details.assetAllocation.reduce((sum, part) => sum + part.valueCents, 0)).toBe(summary.assetsCents);
  expect(details.assetAllocation.reduce((sum, part) => sum + part.percent, 0)).toBeCloseTo(100);
  expect(new Set(details.assets.map(row => row.id)).size).toBe(details.assets.length);
  const legacy = wealthBreakdown({ assets: [], accounts: [{ ...summary.accounts[0], type: undefined }] });
  expect(legacy.assetAllocation[0].kind).toBe('account_other');
});
