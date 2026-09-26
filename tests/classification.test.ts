import { expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Repository } from '../src/server/storage/repository.js';
import { ClassificationService } from '../src/server/services/classification.js';
import { toClassificationInput, validateClassifications, type ClassificationInput } from '../src/server/integrations/codex/classifier.js';
import { normalize, summarize, transactionId } from '../src/server/domain/ledger.js';
import type { RawRecord } from '../src/shared/models.js';

const response = (inputs: ClassificationInput[]) => ({ classifications: inputs.map((input) => ({ ref: input.ref, category: 'dining', country: 'JP', kind: 'expense', reason: "The description identifies a Tokyo restaurant.", needsReview: false })) });
async function fixture(count = 1) {
  const directory = await mkdtemp(join(tmpdir(), 'respect-money-classification-'));
  const repository = await new Repository(directory).initialize();
  const account = await repository.addAccount({ name: 'Fictional card', institution: 'Chase', type: 'credit', mask: '1827' });
  const records: RawRecord[] = Array.from({ length: count }, (_, i) => ({ accountId: account.id, source: 'plaid_transactions', payload: { transaction_id: `fictional-${i}`, name: 'Tokyo cafe', date: '2026-08-01', amount: 10, iso_currency_code: 'USD', secret: 'DO_NOT_SEND', account_id: 'PRIVATE_BANK_ACCOUNT' } }));
  await repository.importRecords(records, { [account.id]: [{ start: '2026-01-01', end: '2026-08-31' }] });
  return { repository, account, records, close: async () => { await repository.close(); await rm(directory, { recursive: true, force: true }); } };
}
const progress = async () => undefined;

it('retains a saved classification when the bank updates an existing transaction and flags direction conflicts', async () => {
  const f = await fixture();
  try {
    const classify = vi.fn(async (inputs: ClassificationInput[]) => response(inputs));
    const service = new ClassificationService(f.repository, classify, 'test');
    await service.publish([f.account.id], false, progress);
    const id = transactionId(f.records[0]);
    const original = f.repository.snapshot().classifications[id];
    const updated = { ...f.records[0], payload: { ...f.records[0].payload, amount: 20, date: '2026-08-02', merchant_name: 'Updated cafe' } };
    await f.repository.importRecords([updated], {});
    expect((await service.publish([f.account.id], false, progress)).total).toBe(0);
    expect(f.repository.snapshot().classifications[id]).toEqual({ ...original, sourceHash: normalize(updated).sourceHash });
    expect(f.repository.snapshot().processed[0]).toMatchObject({ category: 'dining', country: 'JP', cashflowCents: -2000, postedDate: '2026-08-02', classificationSource: 'codex' });
    await f.repository.importRecords([{ ...updated, payload: { ...updated.payload, amount: -20 } }], {});
    await service.publish([f.account.id], false, progress);
    expect(classify).toHaveBeenCalledTimes(1);
    expect(f.repository.snapshot().processed[0]).toMatchObject({ category: 'dining', kind: 'review', needsReview: true });
    expect(summarize(f.repository.snapshot().processed)).toMatchObject({ incomeCents: 0, expenseCents: 0, reviewCount: 1 });
  } finally { await f.close(); }
});

it('classifies only new records after a model or prompt change and preserves manual categories', async () => {
  const f = await fixture();
  try {
    const classify = vi.fn(async (inputs: ClassificationInput[]) => response(inputs));
    await new ClassificationService(f.repository, classify, 'original-model-and-prompt').publish([f.account.id], false, progress);
    const cached = f.repository.snapshot().classifications;
    const service = new ClassificationService(f.repository, classify, 'updated-model-and-prompt');
    expect((await service.publish([f.account.id], false, progress)).total).toBe(0);
    const newRecord = { ...f.records[0], payload: { ...f.records[0].payload, transaction_id: 'new', name: 'New cafe' } };
    const manualRecord = { ...f.records[0], payload: { ...f.records[0].payload, transaction_id: 'manually-classified' } };
    await f.repository.importRecords([newRecord, manualRecord], {});
    const manualId = transactionId(manualRecord);
    await f.repository.editOverride(manualId, f.repository.version(f.repository.snapshot(), manualId), { category: 'groceries' });
    expect((await service.publish([f.account.id], false, progress)).total).toBe(1);
    expect(classify).toHaveBeenCalledTimes(2);
    expect(classify.mock.calls[1][0]).toMatchObject([{ description: 'New cafe' }]);
    expect(f.repository.snapshot().classifications[transactionId(f.records[0])]).toEqual(cached[transactionId(f.records[0])]);
    expect(f.repository.snapshot().processed.find((row) => row.id === manualId)?.category).toBe('groceries');
    expect((await service.publish([f.account.id], false, progress)).total).toBe(0);
    expect(classify).toHaveBeenCalledTimes(2);
    expect((await service.publish([f.account.id], true, progress, { start: '2026-08-01', end: '2026-08-31' })).total).toBe(3);
    expect(f.repository.snapshot().classifications[transactionId(f.records[0])].classifierVersion).toBe(service.version);
    expect(f.repository.snapshot().processed.find((row) => row.id === manualId)?.category).toBe('groceries');
  } finally { await f.close(); }
});

it('replaces an old income classification for a truncated card repayment without calling AI', async () => {
  const f = await fixture();
  try {
    const record = { ...f.records[0], payload: { ...f.records[0].payload, name: 'AUTOMATIC PAYMENT - THANK', amount: -10 } };
    await f.repository.importRecords([record], {});
    const tx = normalize(record);
    await f.repository.change((state) => {
      state.classifications[tx.id] = {
        sourceHash: tx.sourceHash, kind: 'income', category: 'uncategorized', country: 'US', countrySource: 'default',
        needsReview: false, reason: "The old classification incorrectly counted this as income.", classifierVersion: 'old-version', classifiedAt: '2026-08-01T00:00:00.000Z',
      };
    });
    expect(summarize(f.repository.snapshot().processed).incomeCents).toBe(1000);
    const classify = vi.fn(async (inputs: ClassificationInput[]) => response(inputs));
    const service = new ClassificationService(f.repository, classify, 'test');
    expect((await service.publish([f.account.id], false, progress)).failed).toBe(0);
    expect(classify).not.toHaveBeenCalled();
    expect(f.repository.snapshot().classifications[tx.id]).toBeUndefined();
    expect(f.repository.snapshot().processed[0]).toMatchObject({ kind: 'payment', needsReview: false });
    expect(summarize(f.repository.snapshot().processed)).toMatchObject({ incomeCents: 0, expenseCents: 0, reviewCount: 0 });
  } finally { await f.close(); }
});

it('uses minimal inputs, caches validated output and preserves edits made while Codex is running', async () => {
  const f = await fixture(); const id = transactionId(f.records[0]);
  try {
    const classify = vi.fn(async (inputs: ClassificationInput[]) => {
      expect(JSON.stringify(inputs)).not.toContain('DO_NOT_SEND'); expect(JSON.stringify(inputs)).not.toContain('PRIVATE_BANK_ACCOUNT');
      await f.repository.editOverride(id, f.repository.version(f.repository.snapshot(), id), { country: 'CN', category: 'groceries' });
      return response(inputs);
    });
    const service = new ClassificationService(f.repository, classify, 'test');
    await service.publish([f.account.id], false, progress);
    expect(f.repository.snapshot().processed[0]).toMatchObject({ country: 'CN', category: 'groceries', cashflowCents: -1000 });
    await service.publish([f.account.id], false, progress);
    expect(classify).toHaveBeenCalledTimes(1);
    expect(summarize(f.repository.snapshot().processed).expenseCents).toBe(1000);
  } finally { await f.close(); }
});

it('rejects missing, duplicate, extra or amount-changing outputs and defaults unknown location', async () => {
  const f = await fixture();
  try {
    const input = [toClassificationInput(normalize(f.records[0]), f.account, 'r0')];
    const row = response(input).classifications[0];
    expect(() => validateClassifications({ classifications: [] }, input)).toThrow();
    expect(() => validateClassifications({ classifications: [row, row] }, input)).toThrow();
    expect(() => validateClassifications({ classifications: [{ ...row, ref: 'unexpected' }] }, input)).toThrow();
    expect(() => validateClassifications({ classifications: [{ ...row, cashflowCents: -1 }] }, input)).toThrow();
    expect(() => validateClassifications({ classifications: [{ ...row, kind: 'income' }] }, input)).toThrow();
    expect(() => validateClassifications({ classifications: [{ ...row, category: 'internal_transfer' }] }, input)).toThrow();
    expect(() => validateClassifications({ classifications: [{ ...row, category: 'internal_transfer', kind: 'transfer', needsReview: true }] }, input)).toThrow();
    expect(validateClassifications({ classifications: [{ ...row, category: 'internal_transfer', kind: 'transfer' }] }, input)[0].kind).toBe('transfer');
    expect(() => validateClassifications({ classifications: [{ ...row, category: 'internal_transfer', kind: 'transfer' }] }, [{ ...input[0], source: 'manual', suggestedKind: 'expense' }])).toThrow();
    const service = new ClassificationService(f.repository, async (inputs) => ({ classifications: response(inputs).classifications.map((row) => ({ ...row, country: null })) }), 'test');
    await service.publish([f.account.id], false, progress);
    expect(f.repository.snapshot().processed[0]).toMatchObject({ country: 'US', countrySource: 'default' });
  } finally { await f.close(); }
});

it('keeps a manually confirmed internal transfer out of review and protects it during reclassification and bank updates', async () => {
  const f = await fixture(); const id = transactionId(f.records[0]);
  try {
    const classify = vi.fn(async (inputs: ClassificationInput[]) => ({ classifications: response(inputs).classifications.map((row) => ({ ...row, kind: 'review', needsReview: true })) }));
    const service = new ClassificationService(f.repository, classify, 'test');
    await service.publish([f.account.id], false, progress);
    expect(f.repository.snapshot().processed[0].needsReview).toBe(true);
    await f.repository.editOverride(id, f.repository.version(f.repository.snapshot(), id), { category: 'internal_transfer' });
    expect(f.repository.snapshot().processed[0]).toMatchObject({ kind: 'transfer', needsReview: false });
    await f.repository.importRecords([{ ...f.records[0], payload: { ...f.records[0].payload, amount: 20 } }], {});
    await service.publish([f.account.id], true, progress);
    expect(classify).toHaveBeenCalledTimes(1);
    expect(f.repository.snapshot().processed[0]).toMatchObject({ kind: 'transfer', category: 'internal_transfer', needsReview: false, cashflowCents: -2000, classificationSource: 'manual' });
    expect(summarize(f.repository.snapshot().processed)).toMatchObject({ incomeCents: 0, expenseCents: 0, reviewCount: 0 });
    await f.repository.editOverride(id, f.repository.version(f.repository.snapshot(), id), { category: 'dining' });
    expect(summarize(f.repository.snapshot().processed).expenseCents).toBe(2000);
  } finally { await f.close(); }
});

it('keeps a manually selected spending category confirmed after AI and source updates', async () => {
  const f = await fixture(); const id = transactionId(f.records[0]);
  try {
    const service = new ClassificationService(f.repository, async (inputs) => ({ classifications: response(inputs).classifications.map((row) => ({ ...row, kind: 'review', needsReview: true })) }), 'test');
    await service.publish([f.account.id], false, progress);
    expect(f.repository.snapshot().processed[0].needsReview).toBe(true);
    await f.repository.editOverride(id, f.repository.version(f.repository.snapshot(), id), { category: 'childcare' });
    expect(f.repository.snapshot().processed[0]).toMatchObject({ kind: 'expense', needsReview: false, category: 'childcare' });
    await service.publish([f.account.id], true, progress);
    expect(f.repository.snapshot().processed[0]).toMatchObject({ kind: 'expense', needsReview: false, category: 'childcare' });
    await f.repository.importRecords([{ ...f.records[0], payload: { ...f.records[0].payload, amount: 20 } }], {});
    await service.publish([f.account.id], true, progress);
    expect(summarize(f.repository.snapshot().processed)).toMatchObject({ incomeCents: 0, expenseCents: 2000, reviewCount: 0 });
  } finally { await f.close(); }
});

it('retains the last account ledger after a failed batch and retries only uncached work', async () => {
  const f = await fixture(55);
  try {
    let calls = 0;
    const classify = vi.fn(async (inputs: ClassificationInput[]) => { calls++; if (calls === 2) throw new Error('Timeout'); return response(inputs); });
    const service = new ClassificationService(f.repository, classify, 'test');
    const result = await service.publish([f.account.id], false, progress);
    expect(result.failed).toBe(1); expect(f.repository.snapshot().staleAccountIds).toContain(f.account.id);
    expect(f.repository.snapshot().processed[0].category).toBe('uncategorized');
    await service.publish([f.account.id], false, progress);
    expect(classify.mock.calls[2][0]).toHaveLength(5);
    expect(f.repository.snapshot().staleAccountIds).toEqual([]);
    expect(f.repository.snapshot().processed.every((r) => r.category === 'dining')).toBe(true);
  } finally { await f.close(); }
});

it('does not publish classification for a changed source or replace an invalidated split', async () => {
  const f = await fixture(); const id = transactionId(f.records[0]);
  try {
    const classify = async (inputs: ClassificationInput[]) => {
      await f.repository.importRecords([{ ...f.records[0], payload: { ...f.records[0].payload, amount: 20 } }], {});
      return response(inputs);
    };
    const service = new ClassificationService(f.repository, classify, 'test');
    expect((await service.publish([f.account.id], false, progress)).failed).toBe(1);
    expect(f.repository.snapshot().classifications[id]).toBeUndefined();
    expect(f.repository.snapshot().staleAccountIds).toContain(f.account.id);
  } finally { await f.close(); }
});
