import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Repository } from '../src/server/storage/repository.js';
import { duplicateCandidates } from '../src/server/domain/duplicates.js';
import { summarize, transactionId } from '../src/server/domain/ledger.js';
import { ClassificationService } from '../src/server/services/classification.js';

it('links a manual duplicate without deleting it and flags a removed bank counterpart', async () => {
  const path = await mkdtemp(join(tmpdir(), 'respect-money-match-')); const repository = await new Repository(path).initialize();
  try {
    const account = await repository.addAccount({ name: 'Test manual', institution: 'Bank', type: 'credit', mask: '1111' });
    const id = await repository.addManual({ accountId: account.id, postedDate: '2026-08-10', amount: '10', description: 'Test lunch', kind: 'expense', category: 'dining', country: 'US', notes: '' });
    const record = { accountId: account.id, source: 'plaid_transactions' as const, payload: { transaction_id: 'bank', date: '2026-08-11', amount: 10, name: 'Lunch', iso_currency_code: 'USD' } };
    await repository.importRecords([record], { [account.id]: [{ start: '2026-08-01', end: '2026-08-31' }] });
    expect(duplicateCandidates(repository.snapshot(), '2026-08')).toHaveLength(1);
    await repository.editOverride(id, repository.version(repository.snapshot(), id), { duplicateOf: transactionId(record) });
    expect(summarize(repository.snapshot().processed).expenseCents).toBe(1000);
    expect(Object.keys(repository.snapshot().records)).toHaveLength(2);
    const classifier = new ClassificationService(repository, async (inputs) => ({ classifications: inputs.map((t) => ({ ref: t.ref, kind: 'expense', category: 'dining', country: null, needsReview: false, reason: 'Test' })) }), 'test');
    await classifier.publish([account.id], true, async () => undefined);
    expect(summarize(repository.snapshot().processed).expenseCents).toBe(1000);
    expect(repository.snapshot().overrides[id].duplicateOf).toBe(transactionId(record));
    await repository.importRecords([], {}, [transactionId(record)]);
    expect(summarize(repository.snapshot().processed)).toMatchObject({ expenseCents: 0, reviewCount: 1 });
  } finally { await repository.close(); await rm(path, { recursive: true, force: true }); }
});
