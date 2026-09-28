import { describe, expect, it } from 'vitest';
import { cents, createLedger, normalize, summarize } from '../src/server/domain/ledger.js';
import { type Account, type Classification, type RawRecord, type TransactionOverride } from '../src/shared/models.js';

const account: Account = { id: 'fictional', name: 'Fictional account', institution: 'Test Bank', mask: '0000', type: 'credit', source: 'plaid', enabled: true, createdAt: '2026-01-01' };
const ranges = { fictional: [{ start: '2026-01-01', end: '2026-12-31' }] };
const raw = (payload: Record<string, unknown>): RawRecord => ({ accountId: account.id, source: 'plaid_transactions', payload: { transaction_id: 't1', date: '2026-08-15', amount: 100, name: 'Fictional store', iso_currency_code: 'USD', ...payload } });
const ledger = (records: RawRecord[]) => createLedger(records, [account], {}, {}, ranges);

describe('ledger invariants', () => {
  it.each(['codex', 'claude'] as const)('includes uncategorized %s results in review without removing known cash flows from totals', (provider) => {
    const record = raw({});
    const tx = normalize(record);
    const classification: Classification = { provider, sourceHash: tx.sourceHash, kind: 'expense', category: 'uncategorized', country: 'US', countrySource: 'default', reason: 'Category unknown.', needsReview: false, classifiedAt: '2026-08-15', classifierVersion: 'test' };
    const rows = createLedger([record], [account], {}, { [tx.id]: classification }, ranges);
    expect(rows[0]).toMatchObject({ needsReview: false, classificationSource: provider });
    expect(summarize(rows)).toMatchObject({ expenseCents: 10000, netCents: -10000, reviewCount: 1, reviewCents: 10000 });
    expect(summarize([{ ...rows[0], currency: 'CAD' }])).toMatchObject({ expenseCents: 0, reviewCount: 1, reviewCents: 0 });
    expect(summarize([{ ...rows[0], excluded: true }])).toMatchObject({ expenseCents: 0, reviewCount: 0, reviewCents: 0 });
    for (const kind of ['payment', 'transfer', 'investment', 'reinvestment', 'excluded'] as const) {
      expect(summarize([{ ...rows[0], kind }])).toMatchObject({ expenseCents: 0, reviewCount: 0 });
    }
  });
  it('resolves manual categories without discarding explicit review or structural problems', () => {
    const record = raw({ name: 'Zelle purchase' });
    const tx = normalize(record);
    const review: Classification = { sourceHash: tx.sourceHash, kind: 'review', category: 'dining', country: 'US', countrySource: 'default', reason: 'Uncertain transaction.', needsReview: true, classifiedAt: '2026-08-15', classifierVersion: 'test' };
    const evaluate = (changes: Partial<TransactionOverride>, classification = review) => createLedger([record], [account], { [tx.id]: { revision: 1, updatedAt: '2026-08-15', ...changes } }, { [tx.id]: classification }, ranges)[0];
    expect(evaluate({ category: 'childcare' })).toMatchObject({ kind: 'expense', needsReview: false, category: 'childcare', classificationSource: 'manual' });
    expect(evaluate({ category: 'childcare' }, { ...review, kind: 'expense' })).toMatchObject({ kind: 'expense', needsReview: false });
    expect(evaluate({ country: 'CN' })).toMatchObject({ kind: 'review', needsReview: true });
    expect(evaluate({ category: 'uncategorized' })).toMatchObject({ kind: 'review', needsReview: true });
    expect(evaluate({ category: 'childcare', kind: 'review' })).toMatchObject({ kind: 'review', needsReview: true });
    expect(evaluate({ category: 'salary', kind: 'income' })).toMatchObject({ kind: 'review', needsReview: true });
    expect(evaluate({ category: 'childcare', duplicateOf: 'missing' })).toMatchObject({ kind: 'review', needsReview: true });
    expect(evaluate({ category: 'childcare', splits: [{ id: 'part', description: '', cashflowCents: -1, kind: 'expense', category: 'childcare', country: 'US' }] })).toMatchObject({ kind: 'review', needsReview: true });
  });
  it('distinguishes incoming income, purchase refunds and card repayments after manual categorization', () => {
    for (const [name, category, expected] of [['Zelle received', 'salary', 'income'], ['Transfer received', 'investments', 'income'], ['Zelle reimbursement', 'dining', 'refund'], ['Payment thank you', 'dining', 'payment']] as const) {
      const record = raw({ name, amount: -100 });
      const tx = normalize(record);
      const rows = createLedger([record], [account], { [tx.id]: { revision: 1, updatedAt: '2026-08-15', category } }, {}, ranges);
      expect(rows[0]).toMatchObject({ kind: expected, cashflowCents: 10000, needsReview: false });
    }
  });
  it('uses exact cents and excludes both sides of repayment and pending purchases', () => {
    expect(cents('0.29')).toBe(29);
    const rows = ledger([
      raw({}), raw({ transaction_id: 'payment', amount: -100, name: 'Payment thank you' }),
      raw({ transaction_id: 'payment-out', amount: 100, personal_finance_category: { detailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' } }),
      raw({ transaction_id: 'pending', pending: true, amount: 20 }),
    ]);
    expect(summarize(rows).expenseCents).toBe(10000);
    expect(summarize(rows).incomeCents).toBe(0);
    expect(rows).toHaveLength(3);
  });
  it.each(['AUTOMATIC PAYMENT - THANK', 'AUTOMATIC PAYMENT - THANK YOU', 'automatic payment-thank', 'Automatic  Payment —  Thank', 'PAYMENT THANK YOU'])('excludes both cashflow directions of the repayment description %s', (name) => {
    for (const amount of [100, -100]) {
      const rows = ledger([raw({ name, amount })]);
      expect(rows[0]).toMatchObject({ kind: 'payment', needsReview: false });
      expect(summarize(rows)).toMatchObject({ incomeCents: 0, expenseCents: 0, netCents: 0, reviewCount: 0 });
    }
  });
  it('keeps ordinary automatic bills and subscriptions as expenses', () => {
    const rows = ledger([
      raw({ transaction_id: 'utility', name: 'AUTOMATIC PAYMENT - ELECTRIC BILL', personal_finance_category: { primary: 'RENT_AND_UTILITIES' } }),
      raw({ transaction_id: 'subscription', name: 'AUTOPAY - STREAMING SUBSCRIPTION', personal_finance_category: { primary: 'ENTERTAINMENT' } }),
    ]);
    expect(rows.every((row) => row.kind === 'expense')).toBe(true);
    expect(summarize(rows)).toMatchObject({ incomeCents: 0, expenseCents: 20000, reviewCount: 0 });
  });
  it('records refunds in the arrival month, including a negative expense month', () => {
    const rows = ledger([raw({}), raw({ transaction_id: 'refund', date: '2026-09-01', amount: -30, name: 'Refund from fictional store' })]);
    expect(summarize(rows.filter((r) => r.postedDate.startsWith('2026-08'))).expenseCents).toBe(10000);
    expect(summarize(rows.filter((r) => r.postedDate.startsWith('2026-09'))).expenseCents).toBe(-3000);
  });
  it('uses the actual country and defaults missing country to the US without guessing', () => {
    expect(normalize(raw({ location: { country: 'JP' } })).country).toBe('JP');
    expect(normalize(raw({}))).toMatchObject({ country: 'US', countrySource: 'default' });
  });
  it('excludes unambiguous paired own-account transfers while leaving friend transfers for review', () => {
    const second = { ...account, id: 'second' };
    const out = raw({ transaction_id: 'out', personal_finance_category: { primary: 'TRANSFER_OUT', detailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER' } });
    const incoming = { ...raw({ transaction_id: 'in', amount: -100, personal_finance_category: { primary: 'TRANSFER_IN', detailed: 'TRANSFER_IN_ACCOUNT_TRANSFER' } }), accountId: second.id };
    const rows = createLedger([out, incoming, raw({ transaction_id: 'friend', amount: -25, name: 'Zelle from friend' })], [account, second], {}, {}, { ...ranges, second: ranges.fictional });
    expect(rows.filter((r) => r.kind === 'transfer')).toHaveLength(2);
    expect(summarize(rows)).toMatchObject({ incomeCents: 0, expenseCents: 0, reviewCount: 1 });
  });
  it('counts investment cash income and separate fees while excluding trades and reinvestments', () => {
    const investment = (id: string, amount: number, type: string, subtype: string, security = id): RawRecord => ({ accountId: account.id, source: 'plaid_investments', payload: { investment_transaction_id: id, date: '2026-08-15', amount, type, subtype, security_id: security, name: `Fictional ${id}`, iso_currency_code: 'USD' } });
    const rows = ledger([
      investment('dividend', -50, 'cash', 'dividend'), investment('interest', -10, 'cash', 'interest'),
      investment('fee', 5, 'fee', 'account fee'), investment('buy', 1000, 'buy', 'buy'),
      investment('reinvest', 20, 'buy', 'dividend reinvestment', 'fund'), investment('auto-dividend', -20, 'cash', 'dividend', 'fund'),
    ]);
    expect(summarize(rows)).toMatchObject({ incomeCents: 6000, expenseCents: 500 });
    expect(rows.find((row) => row.sourceId === 'auto-dividend')?.kind).toBe('reinvestment');
    expect(rows.find((row) => row.sourceId === 'buy')).toMatchObject({ kind: 'investment', category: 'investment_transaction', needsReview: false });
  });
  it('does not guess a reinvestment match when security identity is missing', () => {
    const investment = (id: string, amount: number, subtype: string): RawRecord => ({ accountId: account.id, source: 'plaid_investments', payload: { investment_transaction_id: id, date: '2026-08-15', amount, type: subtype === 'dividend' ? 'cash' : 'buy', subtype, security_id: null, name: 'Test activity', iso_currency_code: 'USD' } });
    const rows = ledger([investment('cash', -20, 'dividend'), investment('reinvest', 20, 'dividend reinvestment')]);
    expect(rows.find((r) => r.sourceId === 'cash')?.kind).toBe('review');
    expect(summarize(rows)).toMatchObject({ incomeCents: 0, reviewCount: 1 });
  });
});
