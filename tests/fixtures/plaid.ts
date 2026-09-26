import type { AccountBase, TransactionsSyncResponse } from 'plaid';
import type { PlaidGateway } from '../../src/server/integrations/plaid/client.js';
export const bankAccount = { account_id: 'bank-account', name: 'Test checking', mask: '1827', type: 'depository', subtype: 'checking' } as AccountBase;
export const transaction = (id: string, date = '2026-08-01', amount = 10) => ({ transaction_id: id, account_id: 'bank-account', name: 'Test groceries', date, amount, pending: false, iso_currency_code: 'USD', personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_GROCERIES' } });
export const syncPage = (cursor: string, added: ReturnType<typeof transaction>[] = [], extra: Record<string, unknown> = {}) => ({ added, modified: [], removed: [], accounts: [bankAccount], next_cursor: cursor, has_more: false, transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE', ...extra }) as unknown as TransactionsSyncResponse;
export function fakePlaid(overrides: Partial<PlaidGateway> = {}): PlaidGateway {
  return {
    createLink: async () => ({ link_token: 'test-link', expiration: '2099-01-01T00:00:00Z', request_id: 'test' }),
    exchange: async () => ({ access_token: 'secret-test-token', item_id: 'item', request_id: 'test' }),
    accounts: async () => ({ item: { item_id: 'item' }, accounts: [bankAccount], request_id: 'test' }) as Awaited<ReturnType<PlaidGateway['accounts']>>,
    item: async () => ({ item: { item_id: 'item' }, status: { transactions: { last_successful_update: '2026-08-01T00:00:00Z' } }, request_id: 'test' }) as Awaited<ReturnType<PlaidGateway['item']>>,
    sync: async () => syncPage('cursor', [transaction('test-transaction')]),
    refresh: async () => undefined,
    removeItem: async () => undefined,
    investments: async () => { throw new Error('Unused investment fixture'); },
    holdings: async () => { throw new Error('Unused holdings fixture'); },
    refreshInvestments: async () => undefined,
    ...overrides,
  };
}
