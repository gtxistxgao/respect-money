import { Products, type AccountBase, type InvestmentsTransactionsGetResponse } from 'plaid';
import { fakePlaid, syncPage, transaction } from './plaid.js';
import type { ClassifyBatch } from '../../src/server/integrations/codex/classifier.js';
import type { PlaidGateway } from '../../src/server/integrations/plaid/client.js';

const checking = { account_id: 'bank-account', name: 'Fictional Chase checking', type: 'depository', subtype: 'checking', mask: '1827', balances: { current: 12500, available: 12000, iso_currency_code: 'USD' } } as AccountBase;
const investment = { account_id: 'invest-account', name: 'Fictional Fidelity investment', type: 'investment', subtype: 'brokerage', mask: '2026', balances: { current: 75000, available: 5000, iso_currency_code: 'USD' } } as AccountBase;
const bankRecords = [
  { ...transaction('tokyo', '2026-08-03', 100), name: 'Tokyo cafe', personal_finance_category: undefined },
  { ...transaction('salary', '2026-08-01', -5000), name: 'Fictional payroll', personal_finance_category: { primary: 'INCOME', detailed: 'INCOME_WAGES' } },
  { ...transaction('repayment', '2026-08-05', 100), name: 'Credit card payment', personal_finance_category: { primary: 'LOAN_PAYMENTS', detailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' } },
  { ...transaction('pending', '2026-08-06', 25), pending: true },
  { ...transaction('refund', '2026-09-01', -10), name: 'Purchase refund' },
  { ...transaction('old', '2025-10-20', 5), name: 'Fictional older purchase' },
];

export function integrationPlaid(): PlaidGateway {
  return fakePlaid({
    createLink: async (request) => ({ link_token: request.products?.includes(Products.Investments) || request.access_token === 'fixture-invest-token' ? 'fixture-invest-link' : 'fixture-bank-link', expiration: '2099-01-01T00:00:00Z', request_id: 'fixture' }),
    exchange: async (publicToken) => ({ access_token: publicToken === 'fixture-invest-public' ? 'fixture-invest-token' : 'fixture-bank-token', item_id: publicToken === 'fixture-invest-public' ? 'invest-item' : 'bank-item', request_id: 'fixture' }),
    accounts: async (token) => ({ accounts: token === 'fixture-invest-token' ? [investment] : [checking], item: { item_id: token === 'fixture-invest-token' ? 'invest-item' : 'bank-item' }, request_id: 'fixture' }) as Awaited<ReturnType<PlaidGateway['accounts']>>,
    holdings: async () => ({ item: { item_id: 'invest-item' }, accounts: [investment], securities: [{ security_id: 'fixture-stock', type: 'equity' }, { security_id: 'fixture-fund', type: 'etf' }, { security_id: 'fixture-cash', type: 'cash', is_cash_equivalent: true }], holdings: [['fixture-stock', 50000], ['fixture-fund', 20000], ['fixture-cash', 5000]].map(([security_id, institution_value]) => ({ account_id: 'invest-account', security_id, institution_value, iso_currency_code: 'USD' })), request_id: 'fixture' }) as Awaited<ReturnType<PlaidGateway['holdings']>>,
    item: async (token) => ({ item: { item_id: token === 'fixture-invest-token' ? 'invest-item' : 'bank-item' }, status: { transactions: { last_successful_update: '2026-08-10T00:00:00Z' } }, request_id: 'fixture' }) as Awaited<ReturnType<PlaidGateway['item']>>,
    sync: async (_token, cursor) => syncPage('fixture-cursor', [], { accounts: [checking], added: cursor ? [] : bankRecords }),
    investments: async (_token, range) => ({ item: { item_id: 'invest-item' }, accounts: [investment], securities: [], request_id: 'fixture',
      investment_transactions: range.start <= '2026-08-10' && range.end >= '2026-08-10' ? [{ investment_transaction_id: 'cash-dividend', account_id: 'invest-account', security_id: 'fund', name: 'Fictional cash dividend', date: '2026-08-10', amount: -50, type: 'cash', subtype: 'dividend', iso_currency_code: 'USD', fees: null }] : [],
      total_investment_transactions: range.start <= '2026-08-10' && range.end >= '2026-08-10' ? 1 : 0,
    }) as unknown as InvestmentsTransactionsGetResponse,
  });
}
export const integrationClassifier: ClassifyBatch = async (inputs) => ({ classifications: inputs.map((input) => ({ ref: input.ref,
  kind: input.cashflowCents < 0 ? 'expense' : input.suggestedKind === 'refund' ? 'refund' : 'review',
  category: input.description.includes('Tokyo') ? 'dining' : 'shopping', country: input.description.includes('Tokyo') ? 'JP' : null,
  reason: "Fictional classification.", needsReview: false,
})) });

// Synthetic matching provider for UI tests; production uses the configured Codex model.
export const integrationPatternMatcher: import('../../src/server/integrations/codex/pattern-matcher.js').MatchPatterns = async (rule, inputs) => ({ reviewedCount: inputs.length, matches: inputs.filter((input) => rule.example.includes('Alex Morgan') && /send to alex morgan\b/i.test(input.description) && Math.abs(input.cashflowCents) >= 45000 && Math.abs(input.cashflowCents) <= 55000).map((input) => ({
  ref: input.ref,
  reason: 'Same recipient; reference IDs differ and the amount is within 10% of the example.',
})) });
