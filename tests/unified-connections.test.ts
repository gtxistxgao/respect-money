import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { PlaidApi, Products, type Item } from 'plaid';
import { Repository } from '../src/server/storage/repository.js';
import { Connections, authorizedProducts } from '../src/server/services/connections.js';
import { Jobs } from '../src/server/services/jobs.js';
import { WealthService } from '../src/server/services/wealth.js';
import { readConfig } from '../src/server/config.js';
import { createPlaidGateway, PlaidFailure } from '../src/server/integrations/plaid/client.js';
import { integrationPlaid } from './fixtures/integration.js';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'respect-money-unified-'));
  const repository = await new Repository(directory).initialize();
  const provider = integrationPlaid();
  const bank = (await provider.accounts('fixture-bank-token')).accounts[0];
  const investment = (await provider.accounts('fixture-invest-token')).accounts[0];
  let accounts = [bank, investment];
  const item = { item_id: 'mixed-item', institution_id: 'fixture-institution', consented_products: [Products.Transactions, Products.Investments], products: [Products.Transactions], billed_products: [Products.Transactions], available_products: [Products.Investments] } as Item;
  const plaid = {
    ...provider,
    exchange: vi.fn(async () => ({ access_token: 'fixture-mixed-token', item_id: item.item_id, request_id: 'fixture' })),
    accounts: vi.fn(async () => ({ accounts, item, request_id: 'fixture' })),
    item: vi.fn(async (token: string) => {
      const response = await provider.item(token);
      return { ...response, item: { ...response.item, item_id: item.item_id, products: item.products, billed_products: item.billed_products, available_products: item.available_products, consented_products: item.consented_products } };
    }),
    sync: vi.fn(async (...args: Parameters<typeof provider.sync>) => ({ ...await provider.sync(...args), accounts })),
    investments: vi.fn(async (...args: Parameters<typeof provider.investments>) => ({ ...await provider.investments(...args), item })),
    holdings: vi.fn(async (...args: Parameters<typeof provider.holdings>) => ({ ...await provider.holdings(...args), item })),
  };
  const connections = new Connections(repository, plaid, readConfig());
  const complete = async (connectionId?: string) => connections.completeLink({ ...(await connections.createLink(connectionId)), publicToken: 'fixture-public', institution: 'Fixture mixed institution' });
  return { repository, plaid, connections, complete, bank, investment, item, setAccounts: (next: typeof accounts) => { accounts = next; }, close: async () => { await repository.close(); await rm(directory, { recursive: true, force: true }); } };
}

it('connects a mixed institution once, routes both ledgers, and counts balances once across repeated syncs', async () => {
  const f = await fixture();
  try {
    const create = vi.spyOn(f.plaid, 'createLink');
    await f.complete();
    expect(create.mock.calls[0][0]).toMatchObject({ products: ['transactions'], additional_consented_products: ['investments'], transactions: { days_requested: 730 } });
    expect(f.repository.snapshot().accounts.map((account) => account.type)).toEqual(['checking', 'investment']);
    const ids = f.repository.snapshot().accounts.map((account) => account.id);
    const jobs = new Jobs(f.repository, f.plaid, { attempts: 1, delayMs: 0 });
    for (let attempt = 0; attempt < 2; attempt++) {
      const job = await jobs.enqueue({ type: 'sync', range: { start: '2026-08-01', end: '2026-08-31' } });
      await jobs.idle();
      expect(f.repository.snapshot().jobs[job.id].status).toBe('succeeded');
    }
    const snapshot = f.repository.snapshot();
    expect(snapshot.accounts.map((account) => account.id)).toEqual(ids);
    expect(Object.keys(snapshot.records)).toHaveLength(7);
    expect(snapshot.processed.filter((row) => row.description === 'Fictional cash dividend')).toHaveLength(1);
    expect(f.plaid.sync).toHaveBeenCalledTimes(2);
    expect(f.plaid.investments).toHaveBeenCalledTimes(2);
    const wealth = new WealthService(f.repository, f.plaid);
    wealth.refresh(); await wealth.close();
    expect(wealth.summary()).toMatchObject({ assetsCents: 8750000, errors: [] });
    expect(f.plaid.holdings).toHaveBeenCalledTimes(1);
    expect(f.plaid.exchange).toHaveBeenCalledTimes(1);
    expect(Object.keys(snapshot.connections)).toEqual(['mixed-item']);
  } finally { await f.close(); }
});

it('adds investments to an existing bank connection without replacing IDs or local ledger preferences', async () => {
  const f = await fixture();
  try {
    f.setAccounts([f.bank]); f.item.consented_products = [Products.Transactions];
    await f.complete();
    const original = f.repository.snapshot().accounts[0];
    await f.repository.change((state) => { state.accounts[0].enabled = false; });
    const create = vi.spyOn(f.plaid, 'createLink');
    const session = await f.connections.createLink('mixed-item');
    expect(create.mock.calls[0][0]).toMatchObject({ access_token: 'fixture-mixed-token', update: { account_selection_enabled: true }, additional_consented_products: ['transactions', 'investments'] });
    expect(create.mock.calls[0][0].products).toBeUndefined();
    f.setAccounts([f.bank, f.investment]); f.item.consented_products = [Products.Transactions, Products.Investments];
    await f.connections.completeLink({ sessionId: session.sessionId, institution: 'Fixture mixed institution', selectedAccountIds: ['bank-account', 'invest-account'] });
    expect(f.repository.snapshot().accounts[0]).toMatchObject({ id: original.id, enabled: false });
    expect(f.repository.snapshot().accounts[1]).toMatchObject({ type: 'investment', enabled: true });
    expect(f.repository.snapshot().connections['mixed-item'].products).toEqual(['transactions', 'investments']);
    expect(f.plaid.exchange).toHaveBeenCalledTimes(1);
    f.setAccounts([f.investment]); await f.complete('mixed-item');
    expect(f.repository.snapshot().accounts[0].enabled).toBe(false);
    expect(f.repository.snapshot().accounts).toHaveLength(2);
  } finally { await f.close(); }
});

it('imports explicitly consented investments absent from all availability lists and repairs a previously filtered connection', async () => {
  const f = await fixture();
  try {
    f.item.available_products = [Products.Balance];
    await f.complete();
    expect(f.repository.snapshot().connections['mixed-item'].products).toEqual(['transactions', 'investments']);
    const create = vi.spyOn(f.plaid, 'createLink');
    await f.connections.createLink('mixed-item');
    expect(create.mock.calls[0][0].additional_consented_products).toEqual(['transactions', 'investments']);
    await f.repository.change(state => { state.connections['mixed-item'].products = ['transactions']; }, false);
    const wealth = new WealthService(f.repository, f.plaid);
    wealth.refresh(); await wealth.close();
    expect(f.plaid.holdings).toHaveBeenCalledOnce();
    expect(wealth.summary().errors).toEqual([]);
    expect(f.repository.snapshot().connections['mixed-item'].products).toEqual(['transactions', 'investments']);
    await f.repository.change(state => {
      Object.assign(state.connections['mixed-item'], { products: ['transactions'], status: 'error', lastError: 'Previous access warning' });
    }, false);
    const jobs = new Jobs(f.repository, f.plaid, { attempts: 1, delayMs: 0 });
    const job = await jobs.enqueue({ type: 'sync', range: { start: '2026-08-01', end: '2026-08-31' } });
    await jobs.idle();
    const state = f.repository.snapshot();
    expect(state.jobs[job.id]).toMatchObject({ status: 'succeeded', errors: [] });
    expect(state.connections['mixed-item']).toMatchObject({ products: ['transactions', 'investments'], status: 'connected' });
    expect(state.connections['mixed-item'].lastError).toBeUndefined();
    expect(f.plaid.sync).toHaveBeenCalledOnce();
    expect(f.plaid.investments).toHaveBeenCalledOnce();
    expect(state.processed.some(row => row.description === 'Fictional cash dividend')).toBe(true);
  } finally { await f.close(); }
});

it.each(['PRODUCT_NOT_READY', 'PRODUCT_NOT_SUPPORTED'])('reports the actual %s response for consented investments without claiming consent is missing', async code => {
  const f = await fixture();
  try {
    f.item.available_products = [Products.Balance];
    await f.complete();
    f.plaid.investments.mockRejectedValue(new PlaidFailure(code));
    const jobs = new Jobs(f.repository, f.plaid, { attempts: 1, delayMs: 0 });
    const job = await jobs.enqueue({ type: 'sync', range: { start: '2026-08-01', end: '2026-08-31' } });
    await jobs.idle();
    const result = f.repository.snapshot().jobs[job.id];
    expect(result.status).toBe('partial_failed');
    expect(f.plaid.investments).toHaveBeenCalledOnce();
    expect(JSON.stringify(result.errors)).toContain(new PlaidFailure(code).message);
    expect(JSON.stringify(result.errors)).not.toContain('Manage accounts');
  } finally { await f.close(); }
});

it.each(['sync', 'investments'] as const)('still publishes the other account type when %s fails on the same connection', async (failed) => {
  const f = await fixture();
  try {
    await f.complete();
    f.plaid[failed].mockRejectedValue(new PlaidFailure('PRODUCT_NOT_READY'));
    const jobs = new Jobs(f.repository, f.plaid, { attempts: 1, delayMs: 0 });
    const job = await jobs.enqueue({ type: 'sync', range: { start: '2026-08-01', end: '2026-08-31' } });
    await jobs.idle();
    expect(f.repository.snapshot().jobs[job.id].status).toBe('partial_failed');
    expect(f.repository.snapshot().processed.some((row) => row.description === (failed === 'sync' ? 'Fictional cash dividend' : 'Tokyo cafe'))).toBe(true);
    expect(f.plaid.sync).toHaveBeenCalledOnce(); expect(f.plaid.investments).toHaveBeenCalledOnce();
  } finally { await f.close(); }
});

it('honors explicit consent without inferring it from availability, and skips holdings for bank-only accounts', async () => {
  expect(authorizedProducts({ consented_products: [Products.Transactions], available_products: [Products.Transactions, Products.Investments] } as Item, ['transactions', 'investments'])).toEqual(['transactions']);
  expect(authorizedProducts({ consented_products: [Products.Transactions, Products.Investments], available_products: [Products.Transactions] } as Item, ['transactions', 'investments'])).toEqual(['transactions', 'investments']);
  const f = await fixture();
  try {
    f.setAccounts([f.bank]); await f.complete();
    const wealth = new WealthService(f.repository, f.plaid);
    wealth.refresh(); await wealth.close();
    expect(wealth.summary()).toMatchObject({ assetsCents: 1250000, errors: [] });
    expect(f.plaid.holdings).not.toHaveBeenCalled();
  } finally { await f.close(); }
});

it('rejects a duplicate account before exchanging a new token and serializes repeated callbacks', async () => {
  const f = await fixture();
  try {
    const session = await f.connections.createLink();
    const input = { sessionId: session.sessionId, publicToken: 'fixture-public', institution: 'Fixture mixed institution' };
    const callbacks = await Promise.allSettled([f.connections.completeLink(input), f.connections.completeLink(input)]);
    expect(callbacks.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    const second = await f.connections.createLink();
    await expect(f.connections.completeLink({ ...input, sessionId: second.sessionId, institutionId: 'fixture-institution', accounts: [{ id: 'different-provider-id', name: f.bank.name, mask: f.bank.mask, type: 'depository' }] })).rejects.toThrow('already connected');
    expect(f.plaid.exchange).toHaveBeenCalledTimes(1);
    expect(Object.keys(f.repository.snapshot().connections)).toHaveLength(1);
  } finally { await f.close(); }
});

it('retries account discovery with the already exchanged token after a provider failure', async () => {
  const f = await fixture();
  try {
    const session = await f.connections.createLink();
    const input = { sessionId: session.sessionId, publicToken: 'fixture-public', institution: 'Fixture mixed institution' };
    f.plaid.accounts.mockRejectedValueOnce(new PlaidFailure('INSTITUTION_DOWN'));
    await expect(f.connections.completeLink(input)).rejects.toThrow();
    expect(f.repository.snapshot().accounts).toHaveLength(0);
    await f.connections.completeLink(input);
    expect(f.plaid.exchange).toHaveBeenCalledTimes(1);
    expect(f.repository.snapshot().accounts).toHaveLength(2);
  } finally { await f.close(); }
});

it('syncs permitted bank data and requests an authorization update when investment consent is missing', async () => {
  const f = await fixture();
  try {
    f.item.consented_products = [Products.Transactions]; await f.complete();
    const jobs = new Jobs(f.repository, f.plaid, { attempts: 1, delayMs: 0 });
    const job = await jobs.enqueue({ type: 'sync', range: { start: '2026-08-01', end: '2026-08-31' } });
    await jobs.idle();
    const result = f.repository.snapshot().jobs[job.id];
    expect(result.status).toBe('partial_failed');
    expect(JSON.stringify(result.errors)).toContain('Manage accounts');
    expect(f.plaid.sync).toHaveBeenCalledOnce(); expect(f.plaid.investments).not.toHaveBeenCalled();
    expect(f.repository.snapshot().processed.some((row) => row.description === 'Tokyo cafe')).toBe(true);
  } finally { await f.close(); }
});


it.each([['investments'], ['transactions'], ['transactions', 'investments'], []] as const)('manages existing product set %j without invalid update-mode parameters', async (...products) => {
  const f = await fixture();
  try {
    await f.complete();
    await f.repository.change(state => { state.connections['mixed-item'].products = [...products]; }, false);
    const provider = f.plaid.createLink;
    const create = vi.spyOn(f.plaid, 'createLink').mockImplementation(async request => {
      if (request.access_token && (request.products || request.transactions)) throw new PlaidFailure('INVALID_FIELD');
      return provider(request);
    });
    const session = await f.connections.createLink('mixed-item');
    expect(create.mock.calls[0][0]).toMatchObject({ access_token: 'fixture-mixed-token', update: { account_selection_enabled: true }, additional_consented_products: ['transactions', 'investments'] });
    expect(create.mock.calls[0][0]).not.toHaveProperty('transactions');
    expect(create.mock.calls[0][0]).not.toHaveProperty('products');
    expect(f.repository.snapshot().vault.links[session.sessionId]).toMatchObject({ connectionId: 'mixed-item', isUpdate: true });
    await f.connections.completeLink({ sessionId: session.sessionId, institution: 'Fixture mixed institution' });
    expect(Object.keys(f.repository.snapshot().connections)).toEqual(['mixed-item']);
    expect(f.plaid.exchange).toHaveBeenCalledOnce();
  } finally { await f.close(); }
});

it('requests two years of history when Transactions is initialized by the first sync, not during update Link', async () => {
  const sync = vi.spyOn(PlaidApi.prototype, 'transactionsSync').mockResolvedValue({ data: {} } as Awaited<ReturnType<PlaidApi['transactionsSync']>>);
  try {
    const gateway = createPlaidGateway({ ...readConfig(), plaidClientId: 'fixture-client', plaidSecret: 'fixture-secret', plaidEnv: 'sandbox' });
    await gateway.sync('fixture-token');
    expect(sync.mock.calls[0][0]).toMatchObject({ access_token: 'fixture-token', options: { days_requested: 730, include_original_description: true } });
    await gateway.sync('fixture-token', 'fixture-cursor');
    expect(sync.mock.calls[1][0]).toMatchObject({ cursor: 'fixture-cursor', options: { include_original_description: true } });
    expect(sync.mock.calls[1][0].options).not.toHaveProperty('days_requested');
  } finally { sync.mockRestore(); }
});


it('manages a bank-only institution without requesting unsupported investment access', async () => {
  const f = await fixture();
  try {
    f.setAccounts([f.bank]);
    f.item.available_products = [Products.Balance];
    f.item.consented_products = [Products.Transactions];
    await f.complete();
    const before = f.repository.snapshot();
    const provider = f.plaid.createLink;
    const create = vi.spyOn(f.plaid, 'createLink').mockImplementation(async request => {
      if (request.access_token && request.additional_consented_products?.includes(Products.Investments)) throw new PlaidFailure('INVALID_FIELD');
      return provider(request);
    });
    const session = await f.connections.createLink('mixed-item');
    expect(f.plaid.item).toHaveBeenCalledWith('fixture-mixed-token');
    expect(create.mock.calls[0][0].additional_consented_products).toEqual(['transactions']);
    expect(f.repository.snapshot().vault.links[session.sessionId].requestedProducts).toEqual(['transactions']);
    expect(f.repository.snapshot().connections).toEqual(before.connections);
    await f.connections.completeLink({ sessionId: session.sessionId, institution: 'Fixture mixed institution' });
    expect(f.repository.snapshot().connections['mixed-item'].products).toEqual(['transactions']);
    expect(f.repository.snapshot().accounts).toEqual(before.accounts);
    expect(f.plaid.exchange).toHaveBeenCalledOnce();
  } finally { await f.close(); }
});

it('requests only investments when Transactions is unavailable on an existing investment connection', async () => {
  const f = await fixture();
  try {
    f.setAccounts([f.investment]);
    f.item.products = [Products.Investments]; f.item.billed_products = [Products.Investments]; f.item.available_products = [];
    f.item.consented_products = [Products.Investments];
    await f.complete();
    const create = vi.spyOn(f.plaid, 'createLink');
    const session = await f.connections.createLink('mixed-item');
    expect(create.mock.calls[0][0].additional_consented_products).toEqual(['investments']);
    expect(f.repository.snapshot().vault.links[session.sessionId].requestedProducts).toEqual(['investments']);
  } finally { await f.close(); }
});

it('preserves the connection and avoids creating a Link session when capability lookup fails', async () => {
  const f = await fixture();
  try {
    await f.complete();
    const before = f.repository.snapshot();
    const create = vi.spyOn(f.plaid, 'createLink');
    f.plaid.item.mockRejectedValueOnce(new PlaidFailure('NETWORK_ERROR'));
    await expect(f.connections.createLink('mixed-item')).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
    expect(f.repository.snapshot()).toEqual(before);
  } finally { await f.close(); }
});
