import { message as t } from "../../i18n/index.js";
import { existsSync } from 'node:fs';
import { chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { manualAccountInput, manualTransactionInput, overrideSchema, type Account, type DateRange, type RawRecord, type TransactionOverride } from '../../shared/models.js';
import { AppError, cents, createLedger, mergeRanges, normalize, transactionId } from '../domain/ledger.js';
import { emptyState, type RepositoryState } from './state.js';
import { DATABASE_NAME, SqliteStore } from './sqlite-store.js';
import { WriterLock } from './writer-lock.js';
import { hasLegacyData } from './legacy-json.js';
import { mergeInvestmentCategories } from './category-migration.js';
import { applyCategoryPolicy } from '../domain/category-policy.js';
import { resolveCategories } from '../../shared/categories.js';
import { removeAccounts } from './account-removal.js';

export { connectionSchema, jobSchema } from './state.js';
export type { Connection, Job, RepositoryState } from './state.js';

export class Repository {
  private state: RepositoryState = emptyState();
  private queue: Promise<unknown> = Promise.resolve();
  private store?: SqliteStore;
  private readonly lock: WriterLock;
  constructor(readonly root: string) { this.lock = new WriterLock(root); }
  async initialize() {
    await this.lock.acquire();
    try {
      const path = join(this.root, DATABASE_NAME);
      if (!existsSync(path)) {
        if (await hasLegacyData(this.root)) throw new AppError(t("Legacy JSON data detected. Stop the application, run npm run migrate:sqlite, and restart."), 503);
        this.store = await SqliteStore.create(path, this.state);
      } else this.store = SqliteStore.open(path);
      await chmod(path, 0o600);
      this.state = this.store.load();
      const migrated = structuredClone(this.state);
      if (mergeInvestmentCategories(migrated)) await this.change((state) => { Object.assign(state, migrated); }, false);
      const staleJobs = Object.values(this.state.jobs).filter((job) => ['queued', 'fetching', 'classifying', 'publishing'].includes(job.status));
      if (staleJobs.length) await this.change((state) => {
        for (const job of staleJobs) Object.assign(state.jobs[job.id], { status: 'interrupted', message: t("The application restarted. Unfinished tasks can be retried."), updatedAt: new Date().toISOString() });
      }, false);
      // Older releases retained disconnected accounts. Apply the same deletion
      // contract to those orphaned accounts on upgrade, without touching live links.
      const disconnected = new Set(this.state.accounts.filter(a => a.disconnectedAt && !this.state.connections[a.itemId || '']).map(a => a.id));
      if (disconnected.size) await this.change(state => removeAccounts(state, disconnected), false);
      // Persisted published rows are authoritative at startup. Rebuilding them here
      // would change the migrated snapshot or expose unfinished classification work.
    } catch (error) { this.store?.close(); this.store = undefined; await this.lock.release(); throw error; }
    return this;
  }
  snapshot() { const state = structuredClone(this.state); state.processed = state.processed.map(row => applyCategoryPolicy(row, state.settings)); return state; }
  async change<T>(action: (state: RepositoryState) => T | Promise<T>, publish = true): Promise<T> {
    const operation = this.queue.then(async () => {
      if (!this.store) throw new AppError(t("The database has not been initialized."), 503);
      const state = structuredClone(this.state);
      const result = await action(state);
      state.revision++;
      if (publish) {
        const fresh = createLedger(Object.values(state.records), state.accounts, state.overrides, state.classifications, state.ranges, state.settings);
        const stale = new Set(state.staleAccountIds);
        state.processed = [...fresh.filter((row) => !stale.has(row.accountId)), ...this.state.processed.filter((row) => stale.has(row.accountId))];
      }
      this.store.save(this.state.revision, state);
      this.state = state;
      return result;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  async close() { await this.queue; this.store?.close(); this.store = undefined; await this.lock.release(); }
  async addAccount(input: z.infer<typeof manualAccountInput>) {
    const account: Account = { ...manualAccountInput.parse(input), id: randomUUID(), source: 'manual', enabled: true, createdAt: new Date().toISOString() };
    await this.change((state) => { state.accounts.push(account); });
    return account;
  }
  async addManual(input: z.infer<typeof manualTransactionInput>) {
    const value = manualTransactionInput.parse(input);
    const amountCents = cents(value.amount);
    if (amountCents <= 0) throw new AppError(t("The amount must be greater than zero."));
    const id = `manual_${randomUUID()}`;
    await this.change((state) => {
      if (!resolveCategories(state.settings).some(item => item.id === value.category)) throw new AppError(t('Category not found. Refresh categories and retry.'), 400);
      const account = state.accounts.find((a) => a.id === value.accountId);
      if (!account) throw new AppError(t("Select an existing account."));
      if (account.source !== 'manual') throw new AppError(t("Add manual transactions to a manual account to avoid duplicating bank records."));
      state.records[id] = { accountId: value.accountId, source: 'manual', payload: { ...value, amount: undefined, id,
        cashflowCents: amountCents * (['income', 'refund'].includes(value.kind) ? 1 : -1), createdAt: new Date().toISOString() } };
    });
    return id;
  }
  version(state: RepositoryState, id: string) {
    const record = state.records[id];
    if (!record) throw new AppError(t("Transaction not found."), 404);
    return `${normalize(record).sourceHash}:${state.overrides[id]?.revision || 0}`;
  }
  assertVersion(state: RepositoryState, id: string, version: string) {
    if (this.version(state, id) !== version) throw new AppError(t("This transaction was updated. Refresh before editing it again."), 409);
  }
  async editOverride(id: string, version: string, changes: Partial<TransactionOverride>) {
    await this.change((state) => {
      this.assertVersion(state, id, version);
      const tx = normalize(state.records[id]);
      for (const category of [changes.category, ...(changes.splits?.map(split => split.category) ?? [])]) {
        if (category && !resolveCategories(state.settings).some(item => item.id === category)) throw new AppError(t('Category not found. Refresh categories and retry.'), 400);
      }
      if (changes.kind && ((changes.kind === 'income' && tx.cashflowCents < 0) || (changes.kind === 'expense' && tx.cashflowCents > 0) || (changes.kind === 'refund' && tx.cashflowCents < 0))) throw new AppError(t("The selected transaction type conflicts with the cash flow direction."));
      if (changes.splits?.length) {
        if (changes.splits.reduce((sum, split) => sum + split.cashflowCents, 0) !== tx.cashflowCents) throw new AppError(t("Split amounts must add up to the original transaction amount."));
        for (const split of changes.splits) {
          if (!split.cashflowCents || Math.sign(split.cashflowCents) !== Math.sign(tx.cashflowCents)) throw new AppError(t("Each split must have the same cash flow direction as the original transaction."));
          if ((split.kind === 'expense' && split.cashflowCents > 0) || (['income', 'refund'].includes(split.kind) && split.cashflowCents < 0)) throw new AppError(t("The split type conflicts with its cash flow direction."));
          split.id ||= randomUUID();
        }
      }
      state.overrides[id] = overrideSchema.parse({ ...state.overrides[id], ...changes, revision: (state.overrides[id]?.revision || 0) + 1, updatedAt: new Date().toISOString() });
    });
  }
  async importRecords(records: RawRecord[], ranges: Record<string, DateRange[]>, removedIds: string[] = []) {
    await this.change((state) => {
      for (const record of records) state.records[transactionId(record)] = record;
      for (const id of removedIds) delete state.records[id];
      for (const [accountId, additions] of Object.entries(ranges)) state.ranges[accountId] = mergeRanges([...(state.ranges[accountId] || []), ...additions]);
    });
  }
}
