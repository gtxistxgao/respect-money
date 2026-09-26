import { message as t } from "../../i18n/index.js";
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { categories, canonicalCategory, dateSchema, manualAccountInput, manualTransactionInput, monthSchema, overrideInput, splitsInput, today, type LedgerRow } from '../../shared/models.js';
import { AppError, cents, normalize } from '../domain/ledger.js';
import type { Repository } from '../storage/repository.js';
import { duplicateCandidates } from '../domain/duplicates.js';
import { accountCoverage } from '../domain/coverage.js';
import { monthSummary, overview } from '../domain/overview.js';

const querySchema = z.object({
  month: monthSchema, accounts: z.string().optional(), mode: z.enum(['expense', 'income', 'review', 'all']).default('expense'),
  q: z.string().max(200).default(''), categories: z.string().optional(), countries: z.string().optional(),
  from: dateSchema.optional(), to: dateSchema.optional(), min: z.coerce.number().nonnegative().optional(), max: z.coerce.number().nonnegative().optional(),
  sort: z.enum(['date', 'description', 'amount', 'category']).default('date'), direction: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(30),
});

export async function accountingRoutes(app: FastifyInstance, repository: Repository) {
  const selectedRows = (month: string, ids?: string) => {
    const state = repository.snapshot();
    const allowed = new Set(state.accounts.filter((account) => account.enabled && (!ids || ids.split(',').includes(account.id))).map((a) => a.id));
    return state.processed.filter((row) => row.postedDate.startsWith(month) && allowed.has(row.accountId));
  };
  app.get('/api/accounts', async () => repository.snapshot().accounts);
  app.get('/api/accounting/coverage', async () => accountCoverage(repository.snapshot()));
  app.get('/api/accounting/overview', async (request) => {
    const { accounts } = z.object({ accounts: z.string().optional() }).parse(request.query);
    return overview(repository.snapshot(), accounts);
  });
  app.post('/api/accounts/manual', async (request, reply) => reply.code(201).send(await repository.addAccount(manualAccountInput.parse(request.body))));
  app.patch('/api/accounts/:id', async (request) => {
    const { id } = request.params as { id: string };
    const value = z.object({ name: z.string().trim().min(1).max(100).optional(), enabled: z.boolean().optional() }).parse(request.body);
    await repository.change((state) => {
      const account = state.accounts.find((a) => a.id === id);
      if (!account) throw new AppError(t("Account not found."), 404);
      Object.assign(account, value);
    });
    return { ok: true };
  });
  app.get('/api/accounting/months', async () => {
    const state = repository.snapshot();
    const months = new Set(state.processed.map((row) => row.postedDate.slice(0, 7)));
    const currentMonth = today().slice(0, 7);
    for (let year = 2026; year <= Number(currentMonth.slice(0, 4)); year++) for (let month = 1; month <= 12; month++) {
      const key = `${year}-${String(month).padStart(2, '0')}`; if (key <= currentMonth) months.add(key);
    }
    for (const ranges of Object.values(state.ranges)) for (const range of ranges) {
      let cursor = range.start.slice(0, 7);
      let iterations = 0;
      while (cursor <= range.end.slice(0, 7) && iterations++ < 1200) {
        months.add(cursor);
        const [year, month] = cursor.split('-').map(Number);
        cursor = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
      }
    }
    months.add(today().slice(0, 7));
    return [...months].sort().reverse().map((month) => ({ month, count: state.processed.filter((row) => row.postedDate.startsWith(month)).length }));
  });
  app.get('/api/accounting/summary', async (request) => {
    const value = z.object({ month: monthSchema, accounts: z.string().optional() }).parse(request.query);
    return monthSummary(repository.snapshot(), value.month, value.accounts);
  });
  app.get('/api/accounting/transactions', async (request) => {
    const query = querySchema.parse(request.query);
    let rows = selectedRows(query.month, query.accounts);
    if (query.mode === 'expense') rows = rows.filter((r) => ['expense', 'refund'].includes(r.kind) && !r.excluded && r.currency === 'USD');
    if (query.mode === 'income') rows = rows.filter((r) => r.kind === 'income' && !r.excluded && r.currency === 'USD');
    if (query.mode === 'review') rows = rows.filter((r) => (r.kind === 'review' || r.needsReview) && !r.excluded);
    rows = rows.filter((r) => (!query.q || `${r.description} ${r.merchant} ${r.notes}`.toLowerCase().includes(query.q.toLowerCase()))
      && (!query.categories || query.categories.split(',').map(canonicalCategory).includes(r.category)) && (!query.countries || query.countries.split(',').includes(r.country))
      && (!query.from || r.postedDate >= query.from) && (!query.to || r.postedDate <= query.to)
      && (query.min === undefined || Math.abs(r.cashflowCents) >= cents(query.min)) && (query.max === undefined || Math.abs(r.cashflowCents) <= cents(query.max)));
    const key = (r: LedgerRow) => query.sort === 'date' ? r.postedDate : query.sort === 'amount' ? Math.abs(r.cashflowCents) : r[query.sort];
    rows.sort((a, b) => {
      const x = key(a); const y = key(b);
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * (query.direction === 'asc' ? 1 : -1) || a.id.localeCompare(b.id);
    });
    const total = rows.length;
    const subtotalCents = rows.filter((row) => row.currency === 'USD' && !row.excluded && (query.mode === 'review' || query.mode === 'all' || !row.needsReview)).reduce((sum, row) => sum + (query.mode === 'review' ? Math.abs(row.cashflowCents) : row.cashflowCents * (query.mode === 'expense' ? -1 : 1)), 0);
    if (!Number.isSafeInteger(subtotalCents)) throw new AppError(t("The filtered total exceeds the supported range."));
    const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
    return { rows: rows.slice((page - 1) * query.pageSize, page * query.pageSize), total, page, pageSize: query.pageSize, subtotalCents };
  });
  app.get('/api/transactions/:id', async (request) => {
    const { id } = request.params as { id: string };
    const state = repository.snapshot();
    const record = state.records[id];
    if (!record) throw new AppError(t("Transaction not found."), 404);
    const source = normalize(record);
    const effective = state.processed.find((row) => row.parentId === id && !row.splitId);
    const saved = state.classifications[id];
    const classification = saved?.sourceHash === source.sourceHash ? saved : undefined;
    // Editors retain the underlying kind so saving a transfer never reverses its cashflow.
    const editableKind = effective?.category === 'internal_transfer' ? source.source === 'manual' ? source.kind : state.overrides[id]?.kind ?? classification?.kind ?? source.kind : undefined;
    const { raw: _raw, ...transaction } = source;
    void _raw;
    return { transaction: { ...transaction, ...(effective?.sourceHash === source.sourceHash ? { kind: effective.kind === 'excluded' ? source.kind : effective.kind, category: effective.category, country: effective.country } : {}) }, editableKind, override: state.overrides[id], version: repository.version(state, id), reason: effective?.reason || '', classificationSource: effective?.classificationSource || 'rules' };
  });
  app.post('/api/transactions/manual', async (request, reply) => {
    const id = await repository.addManual(manualTransactionInput.parse(request.body));
    return reply.code(201).send({ id });
  });
  app.patch('/api/transactions/manual/:id', async (request) => {
    const { id } = request.params as { id: string };
    const value = manualTransactionInput.extend({ version: z.string() }).parse(request.body);
    await repository.change((state) => {
      repository.assertVersion(state, id, value.version);
      if (state.records[id].source !== 'manual') throw new AppError(t("Original bank transactions cannot be edited directly."));
      if (!state.accounts.some((account) => account.id === value.accountId && account.source === 'manual')) throw new AppError(t("Select a manual account."));
      const amount = cents(value.amount);
      if (amount <= 0) throw new AppError(t("The amount must be greater than zero."));
      const { version: _version, amount: _amount, ...fields } = value;
      void _version; void _amount;
      state.records[id] = { accountId: value.accountId, source: 'manual', payload: { ...state.records[id].payload, ...fields,
        cashflowCents: amount * (['income', 'refund'].includes(value.kind) ? 1 : -1) } };
      if (state.overrides[id]) {
        const override = state.overrides[id];
        for (const field of ['kind', 'category', 'country', 'notes'] as const) delete override[field];
        override.revision++;
      }
    });
    return { ok: true };
  });
  app.put('/api/transactions/:id/overrides', async (request) => {
    const { id } = request.params as { id: string };
    const { version, ...value } = overrideInput.parse(request.body);
    await repository.editOverride(id, version, value);
    return { ok: true };
  });
  app.put('/api/transactions/:id/splits', async (request) => {
    const { id } = request.params as { id: string };
    const value = splitsInput.parse(request.body);
    await repository.editOverride(id, value.version, { splits: value.splits });
    return { ok: true };
  });
  app.get('/api/categories', async () => categories);
  app.post('/api/accounting/publish-rules', async () => {
    // An explicit fallback lets the owner inspect newly synced records even while Codex is unavailable.
    await repository.change((state) => { state.staleAccountIds = []; });
    return { ok: true };
  });
  app.get('/api/accounting/duplicates', async (request) => {
    const { month } = z.object({ month: monthSchema }).parse(request.query);
    return duplicateCandidates(repository.snapshot(), month);
  });
  app.put('/api/transactions/:id/match', async (request) => {
    const { id } = request.params as { id: string };
    const { version, duplicateOf } = z.object({ version: z.string(), duplicateOf: z.string().nullable() }).parse(request.body);
    await repository.change((state) => {
      repository.assertVersion(state, id, version);
      if (state.records[id].source !== 'manual') throw new AppError(t("Only manual entries can be linked to bank transactions."));
      if (duplicateOf) {
        const match = duplicateCandidates(state, normalize(state.records[id]).postedDate.slice(0, 7)).find((item) => item.manual.id === id);
        if (!match?.candidates.some((candidate) => candidate.id === duplicateOf)) throw new AppError(t("The matching bank transaction changed or was already linked. Please review it again."), 409);
      }
      state.overrides[id] = { ...state.overrides[id], duplicateOf, revision: (state.overrides[id]?.revision || 0) + 1, updatedAt: new Date().toISOString() };
    });
    return { ok: true };
  });
}
