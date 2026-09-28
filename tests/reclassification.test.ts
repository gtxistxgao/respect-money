import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { Repository } from '../src/server/storage/repository.js';
import { ReclassificationService } from '../src/server/services/reclassification.js';
import { transactionId } from '../src/server/domain/ledger.js';
import { matchPatternBatch, validatePatternMatches, type MatchPatterns, type PatternTransaction } from '../src/server/integrations/codex/pattern-matcher.js';
import type { RawRecord } from '../src/shared/models.js';
import { buildApp } from '../src/server/app.js';
import { readConfig } from '../src/server/config.js';

const input = { example: 'Send to Alex Morgan, about $500. Ignore reference IDs.', category: 'housing' as const, direction: 'outgoing' as const };
const match: MatchPatterns = async (_rule, rows) => ({ reviewedCount: rows.length, matches: rows.filter((row) => /send to alex morgan\b/i.test(row.description) && Math.abs(row.cashflowCents) >= 45000 && Math.abs(row.cashflowCents) <= 55000).map((row) => ({ ref: row.ref, reason: 'Same recipient and amount within the requested range.' })) });
async function fixture(matcher: MatchPatterns = match) {
  const directory = await mkdtemp(join(tmpdir(), 'respect-money-reclassification-'));
  const repository = await new Repository(directory).initialize();
  const account = await repository.addAccount({ name: 'Fixture account', institution: 'Fixture', type: 'checking', mask: '0000' });
  const records: RawRecord[] = [
    ['one', 'Send to Alex Morgan REF X12345', 500], ['two', 'SEND TO ALEX MORGAN REF Z98765', 520],
    ['other-person', 'Send to Jamie Morgan REF X12345', 500], ['other-amount', 'Send to Alex Morgan REF Y12345', 800],
    ['incoming', 'Send to Alex Morgan REF R12345', -500],
  ].map(([id, name, amount]) => ({ accountId: account.id, source: 'plaid_transactions', payload: { transaction_id: id, name, amount, date: '2026-01-12', iso_currency_code: 'USD', personal_finance_category: { primary: 'TRANSFER_OUT' }, account_id: 'PRIVATE_ACCOUNT', secret: 'PRIVATE_TOKEN' } }));
  await repository.importRecords(records, { [account.id]: [{ start: '2026-01-01', end: '2026-12-31' }] });
  const service = new ReclassificationService(repository, () => matcher);
  const rule = await service.save(input);
  return { directory, repository, service, rule, records, account, close: async () => { await service.close(); await repository.close(); await rm(directory, { recursive: true, force: true }); } };
}

it('previews reference-ID variants without edits and applies only selected matches as persistent manual categories', async () => {
  const matcher = vi.fn(match); const f = await fixture(matcher);
  try {
    const first = transactionId(f.records[0]); const second = transactionId(f.records[1]);
    await f.repository.editOverride(first, f.repository.version(f.repository.snapshot(), first), { notes: 'Keep note', country: 'JP', category: 'dining' });
    const before = f.repository.snapshot();
    const preview = f.service.start(f.rule.id); await f.service.close();
    const ready = f.service.get(preview.id);
    expect(ready).toMatchObject({ status: 'ready', total: 4, scanned: 4, skipped: 1 });
    expect(ready.matches.map((row) => row.id).sort()).toEqual([first, second].sort());
    expect(f.repository.snapshot()).toEqual(before);
    expect(JSON.stringify(matcher.mock.calls)).not.toContain('PRIVATE_ACCOUNT');
    expect(JSON.stringify(matcher.mock.calls)).not.toContain('PRIVATE_TOKEN');
    expect(await f.service.apply(preview.id, [first])).toEqual({ applied: 1 });
    const state = f.repository.snapshot();
    expect(state.processed.find((r) => r.id === first)).toMatchObject({ category: 'housing', kind: 'review', needsReview: true, notes: 'Keep note', country: 'JP', cashflowCents: -50000 });
    expect(state.processed.find((r) => r.id === second)).toMatchObject({ category: 'uncategorized', kind: 'review' });
    await expect(f.service.apply(preview.id, [first])).rejects.toThrow();
    const next = f.service.start(f.rule.id); await f.service.close();
    expect(f.service.get(next.id).matches.map((r) => r.id)).toEqual([second]);
    await f.repository.close();
    const reopened = await new Repository(f.directory).initialize();
    try {
      expect(reopened.snapshot().reclassificationRules).toEqual([f.rule]);
      expect(reopened.snapshot().overrides[first]).toMatchObject({ category: 'housing', notes: 'Keep note', country: 'JP' });
    } finally { await reopened.close(); }
  } finally { await f.close(); }
});

it('atomically rejects stale previews, changed rules, duplicate selections and IDs outside the preview', async () => {
  const f = await fixture();
  try {
    const first = transactionId(f.records[0]); const second = transactionId(f.records[1]);
    const preview = f.service.start(f.rule.id); await f.service.close();
    await expect(f.service.apply(preview.id, ['not-a-match'])).rejects.toThrow();
    await expect(f.service.apply(preview.id, [first, first])).rejects.toThrow();
    await f.repository.editOverride(second, f.repository.version(f.repository.snapshot(), second), { notes: 'Changed after preview' });
    const before = f.repository.snapshot();
    await expect(f.service.apply(preview.id, [first, second])).rejects.toThrow('updated');
    expect(f.repository.snapshot()).toEqual(before);
    const next = f.service.start(f.rule.id); await f.service.close();
    await f.service.save({ ...input, category: 'shopping' }, f.rule.id, f.rule.revision);
    await expect(f.service.apply(next.id, [first])).rejects.toThrow('rule changed');
    await expect(f.service.save(input, f.rule.id, f.rule.revision)).rejects.toThrow('rule changed');
  } finally { await f.close(); }
});

it('skips split, excluded, pending, disabled, non-USD and repayment records and supports incoming direction', async () => {
  const f = await fixture();
  try {
    const [first, second] = f.records.map(transactionId);
    await f.repository.editOverride(first, f.repository.version(f.repository.snapshot(), first), { splits: [{ id: 'part', description: '', cashflowCents: -50000, category: 'shopping', country: 'US', kind: 'expense' }] });
    await f.repository.editOverride(second, f.repository.version(f.repository.snapshot(), second), { excluded: true });
    await f.repository.importRecords([
      ...[{ pending: true }, { iso_currency_code: 'EUR' }, { name: 'AUTOMATIC PAYMENT - THANK', personal_finance_category: {} }].map((extra, index): RawRecord => ({ ...f.records[0], payload: { ...f.records[0].payload, transaction_id: `protected-${index}`, ...extra } })),
    ], {});
    const scan = f.service.start(f.rule.id); await f.service.close();
    expect(f.service.get(scan.id)).toMatchObject({ status: 'ready', total: 2, matches: [] });
    const incoming = await f.service.save({ ...input, direction: 'incoming', category: 'salary' });
    const preview = f.service.start(incoming.id); await f.service.close();
    const matches = f.service.get(preview.id).matches;
    expect(matches).toHaveLength(1);
    await f.service.apply(preview.id, matches.map((r) => r.id));
    expect(f.repository.snapshot().processed.find((r) => r.id === matches[0].id)).toMatchObject({ kind: 'review', category: 'salary', cashflowCents: 50000 });
    await f.repository.change((state) => { state.accounts[0].enabled = false; });
    const disabled = f.service.start(f.rule.id); await f.service.close();
    expect(f.service.get(disabled.id).total).toBe(0);
  } finally { await f.close(); }
});

it('scans 1000 transactions per call without the old byte cap and retains matches across batches', async () => {
  const matcher = vi.fn<MatchPatterns>(async (rule, rows) => {
    const result = await match(rule, rows) as { matches: unknown[] };
    return { reviewedCount: rows.length, matches: result.matches.reverse() };
  });
  const f = await fixture(matcher);
  try {
    await f.repository.importRecords(Array.from({ length: 1001 }, (_, i): RawRecord => ({ ...f.records[0], payload: { ...f.records[0].payload, transaction_id: `batch-${i}` } })), {});
    const before = f.repository.snapshot();
    const preview = f.service.start(f.rule.id); await f.service.close();
    expect(matcher.mock.calls.map(([, rows]) => rows.length)).toEqual([1000, 5]);
    expect(Buffer.byteLength(JSON.stringify(matcher.mock.calls[0][1]))).toBeGreaterThan(24000);
    const result = f.service.get(preview.id);
    expect(result).toMatchObject({ status: 'ready', total: 1005, scanned: 1005 });
    expect(result.matches).toHaveLength(1003);
    expect(new Set(result.matches.map((row) => row.id)).size).toBe(1003);
    expect(result.matches.every((row) => /send to alex morgan\b/i.test(row.description))).toBe(true);
    expect(f.repository.snapshot()).toEqual(before);
  } finally { await f.close(); }
});

it('discards partial scan results after a failed batch and never applies an unfinished scan', async () => {
  let calls = 0;
  const f = await fixture(async (rule, rows) => { if (++calls === 2) throw new Error('PRIVATE diagnostic'); return match(rule, rows); });
  try {
    await f.repository.importRecords(Array.from({ length: 1001 }, (_, i): RawRecord => ({ ...f.records[0], payload: { ...f.records[0].payload, transaction_id: `batch-${i}` } })), {});
    const before = f.repository.snapshot();
    const preview = f.service.start(f.rule.id);
    expect(() => f.service.start(f.rule.id)).toThrow('already running');
    await expect(f.service.apply(preview.id, [transactionId(f.records[0])])).rejects.toThrow();
    await f.service.close();
    expect(f.service.get(preview.id)).toMatchObject({ status: 'failed', matches: [] });
    expect(f.service.get(preview.id).error).not.toContain('PRIVATE');
    expect(f.repository.snapshot()).toEqual(before);
  } finally { await f.close(); }
});

it('accepts sparse and empty matches, deduplicates refs and rejects incomplete or foreign results', () => {
  const rows: PatternTransaction[] = Array.from({ length: 1000 }, (_, i) => ({ ref: `r${i}`, description: 'Fixture', merchant: 'Fixture', cashflowCents: -100, postedDate: '2026-01-01' }));
  const value = { ref: 'r999', reason: 'Fixture reason' };
  expect(validatePatternMatches({ reviewedCount: 1000, matches: [value, value] }, rows)).toEqual([value]);
  expect(validatePatternMatches({ reviewedCount: 1000, matches: [] }, rows)).toEqual([]);
  for (const result of [
    { matches: [value] }, { reviewedCount: 999, matches: [value] },
    { reviewedCount: 1000, matches: [{ ...value, ref: 'foreign' }] },
    { reviewedCount: 1000, matches: [{ ...value, category: 'shopping' }] },
  ]) expect(() => validatePatternMatches(result, rows)).toThrow();
});

it('retries invalid results once with the same batch, without retrying process failures', async () => {
  const rows: PatternTransaction[] = [{ ref: 'r0', description: 'Fixture', merchant: 'Fixture', cashflowCents: -100, postedDate: '2026-01-01' }];
  const value = { ref: 'r0', reason: 'Fixture reason' };
  const matcher = vi.fn<MatchPatterns>().mockResolvedValueOnce({ reviewedCount: 0, matches: [] }).mockResolvedValue({ reviewedCount: 1, matches: [value] });
  expect(await matchPatternBatch(matcher, input, rows)).toEqual([value]);
  expect(matcher.mock.calls).toEqual([[input, rows], [input, rows]]);
  const malformed = vi.fn<MatchPatterns>().mockRejectedValueOnce(new SyntaxError('PRIVATE diagnostic')).mockResolvedValue({ reviewedCount: 1, matches: [] });
  expect(await matchPatternBatch(malformed, input, rows)).toEqual([]);
  expect(malformed).toHaveBeenCalledTimes(2);
  const failed = vi.fn<MatchPatterns>().mockRejectedValue(new Error('process failed'));
  await expect(matchPatternBatch(failed, input, rows)).rejects.toThrow('process failed');
  expect(failed).toHaveBeenCalledTimes(1);
});

it('discards earlier batches when invalid output persists after one automatic retry', async () => {
  const matcher = vi.fn<MatchPatterns>().mockImplementationOnce(match).mockResolvedValue({ reviewedCount: 5, matches: [{ ref: 'foreign', reason: 'Invalid reference' }] });
  const f = await fixture(matcher);
  try {
    await f.repository.importRecords(Array.from({ length: 1001 }, (_, i): RawRecord => ({ ...f.records[0], payload: { ...f.records[0].payload, transaction_id: `retry-${i}` } })), {});
    const before = f.repository.snapshot();
    const preview = f.service.start(f.rule.id); await f.service.close();
    expect(matcher.mock.calls.map(([, rows]) => rows.length)).toEqual([1000, 5, 5]);
    expect(f.service.get(preview.id)).toMatchObject({ status: 'failed', scanned: 1000, matches: [] });
    expect(f.service.get(preview.id).error).toContain('automatic retry');
    await expect(f.service.apply(preview.id, [transactionId(f.records[0])])).rejects.toThrow();
    expect(f.repository.snapshot()).toEqual(before);
  } finally { await f.close(); }
});

it('blocks unpublished ledgers', async () => {
  const f = await fixture();
  try {
    await f.repository.change((state) => { state.staleAccountIds = [f.account.id]; }, false);
    expect(() => f.service.start(f.rule.id)).toThrow('publish');
  } finally { await f.close(); }
});

it('exposes rule CRUD and scan/apply APIs with validation and persistent rules', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'respect-money-reclassification-api-'));
  const app = await buildApp(readConfig(directory), { matchPatterns: match });
  try {
    const created = await app.inject({ method: 'POST', url: '/api/reclassification/rules', payload: input });
    expect(created.statusCode).toBe(201); const rule = created.json();
    expect((await app.inject('/api/reclassification/rules')).json()).toEqual([rule]);
    expect((await app.inject({ method: 'POST', url: '/api/reclassification/rules', payload: { ...input, category: 'invalid' } })).statusCode).toBe(400);
    const scan = await app.inject({ method: 'POST', url: `/api/reclassification/rules/${rule.id}/preview` });
    expect(scan.statusCode).toBe(202);
    const preview = (await app.inject(`/api/reclassification/previews/${scan.json().id}`)).json();
    expect(preview).toMatchObject({ status: 'ready', matches: [] });
    expect((await app.inject({ method: 'POST', url: `/api/reclassification/previews/${preview.id}/apply`, payload: { transactionIds: [] } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: `/api/reclassification/rules/${rule.id}`, payload: { ...input, category: 'dining', revision: rule.revision } })).json().revision).toBe(2);
    expect((await app.inject({ method: 'DELETE', url: `/api/reclassification/rules/${rule.id}`, payload: { revision: 1 } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: `/api/reclassification/rules/${rule.id}`, payload: { revision: 2 } })).statusCode).toBe(200);
    expect((await app.inject('/api/reclassification/rules')).json()).toEqual([]);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
