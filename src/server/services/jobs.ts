import { message as t } from "../../i18n/index.js";
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { rangeSchema, today, type Account, type DateRange } from '../../shared/models.js';
import { AppError, hash } from '../domain/ledger.js';
import { PlaidFailure, safeError, type PlaidGateway } from '../integrations/plaid/client.js';
import type { Job, Repository } from '../storage/repository.js';
import { syncTransactions } from './transactions-sync.js';
import { reconcileAccounts, authorizedProducts } from './connections.js';
import { syncInvestments } from './investments-sync.js';
import { historyFloor } from '../domain/coverage.js';

export type JobInput = { type: 'sync' | 'classify'; range: DateRange; accountIds?: string[]; force?: boolean; refresh?: boolean };
export type Publisher = (accountIds: string[], force: boolean, progress: (done: number, total: number) => Promise<void>, range?: DateRange) => Promise<{ failed: number; total: number; errors?: string[] }>;
const active = (job: Job) => ['queued', 'fetching', 'classifying', 'publishing'].includes(job.status);
const key = (job: JobInput) => hash([job.type, job.range, [...(job.accountIds || [])].sort(), Boolean(job.force), Boolean(job.refresh)]);

export class Jobs {
  private tail: Promise<void> = Promise.resolve();
  private stopping = false;
  private publisher: Publisher;
  constructor(private repository: Repository, private plaid: PlaidGateway, private polling = { attempts: 6, delayMs: 5000 }, publisher?: Publisher) {
    this.publisher = publisher || (async (ids) => { await repository.change((state) => { state.staleAccountIds = state.staleAccountIds.filter((id) => !ids.includes(id)); }); return { failed: 0, total: 0 }; });
  }
  setPublisher(publisher: Publisher) { this.publisher = publisher; }
  async enqueue(input: JobInput) {
    // Bank synchronization is incremental; only an explicit classification job may force a rerun.
    input = { ...input, force: input.type === 'classify' && Boolean(input.force) };
    rangeSchema.parse(input.range);
    if (input.range.end > today() || input.range.start < '1900-01-01') throw new AppError(t("Select a date range between 1900 and today."));
    let created = false;
    const job = await this.repository.change((state) => {
      const available = (account: Account) => input.type === 'classify' || (account.source === 'plaid' && !account.disconnectedAt && Boolean(state.connections[account.itemId || ''] && state.vault.tokens[account.itemId || '']));
      const accountIds = input.accountIds?.length ? [...new Set(input.accountIds)].sort() : state.accounts.filter((a) => a.enabled && available(a)).map((a) => a.id).sort();
      if (!accountIds.length) throw new AppError(t("Connect and enable a bank account, or add a manual account first."));
      if (accountIds.some((id) => !state.accounts.some((a) => a.id === id && available(a)))) throw new AppError(t("Invalid synchronization account."));
      const value = { ...input, accountIds };
      const existing = Object.values(state.jobs).find((job) => active(job) && key(job) === key(value));
      if (existing) return existing;
      const now = new Date().toISOString();
      const job: Job = { ...value, id: randomUUID(), status: 'queued', force: Boolean(input.force), refresh: Boolean(input.refresh), createdAt: now, updatedAt: now, progress: 0, total: accountIds.length, message: t("Added to the task queue."), errors: [] };
      state.jobs[job.id] = job; created = true;
      return job;
    }, false);
    if (created) this.tail = this.tail.then(() => this.run(job)).catch(async (error) => { await this.update(job.id, { status: 'failed', errors: [safeError(error)], message: safeError(error) }).catch(() => undefined); });
    return job;
  }
  private async update(id: string, fields: Partial<Job>) {
    await this.repository.change((state) => { Object.assign(state.jobs[id], fields, { updatedAt: new Date().toISOString() }); }, false);
  }
  private async refreshTransactions(token: string) {
    const baseline = (await this.plaid.item(token)).status?.transactions?.last_successful_update;
    await this.plaid.refresh(token);
    for (let index = 0; index < this.polling.attempts; index++) {
      if (this.stopping) return false;
      await delay(this.polling.delayMs);
      const stamp = (await this.plaid.item(token)).status?.transactions?.last_successful_update;
      if (stamp && stamp !== baseline && (!baseline || stamp > baseline)) return true;
    }
    return false;
  }
  private async run(job: Job) {
    if (this.stopping) { await this.update(job.id, { status: 'interrupted', message: t("The application closed. This task can be retried.") }); return; }
    const errors: string[] = []; const readyAccounts = new Set<string>();
    if (job.type === 'sync') {
      const snapshot = this.repository.snapshot();
      const items = [...new Set(snapshot.accounts.filter((a) => job.accountIds.includes(a.id)).map((a) => a.itemId!))];
      for (const itemId of items) {
        const state = this.repository.snapshot(); const connection = state.connections[itemId];
        if (!connection) { errors.push(t("Account connection not found.")); continue; }
        await this.update(job.id, { status: 'fetching', message: t("Reading {p0}…", { p0: connection.institution }) });
        try {
          const token = state.vault.tokens[itemId];
          const accounts = await this.plaid.accounts(token);
          if (accounts.item.item_id !== itemId) throw new AppError(t('The bank returned an account that does not match this connection.'), 502);
          const products = authorizedProducts(accounts.item, connection.products);
          await this.repository.change((draft) => { reconcileAccounts(draft, itemId, accounts.accounts); draft.connections[itemId].products = products; }, false);
          const requested = this.repository.snapshot().accounts.filter((account) => account.itemId === itemId && job.accountIds.includes(account.id));
          const failures: unknown[] = [];
          const bankAccounts = requested.some((account) => account.type !== 'investment');
          const investmentAccounts = requested.some((account) => account.type === 'investment');
          if ((bankAccounts && !products.includes('transactions')) || (investmentAccounts && !products.includes('investments'))) {
            failures.push(new AppError(t('Some accounts lack data access. Use Manage accounts to update this connection.')));
          }
          if (bankAccounts && products.includes('transactions')) {
            try {
              const floor = historyFloor(connection.createdAt || state.accounts.find((a) => a.itemId === itemId)?.createdAt || today(), connection.requestedHistoryDays || 90);
              if (job.range.start < floor) errors.push(t("{p0}: The selected start date is earlier than this connection's history limit of approximately {p1}. Cached records were preserved; earlier months may remain unavailable.", { p0: connection.institution, p1: floor }));
              if (job.refresh) {
                try { if (!await this.refreshTransactions(token)) errors.push(t("{p0}: Bank refresh was requested and is still pending. Reading data already available in Plaid.", { p0: connection.institution })); }
                catch (error) { errors.push(t("{p0}: Bank refresh did not complete. Reading existing transactions. {p1}", { p0: connection.institution, p1: safeError(error) })); }
              }
              let result = await syncTransactions(this.repository, this.plaid, itemId, job.accountIds, job.range);
              for (let poll = 1; result.historyStatus !== 'HISTORICAL_UPDATE_COMPLETE' && poll < this.polling.attempts && !this.stopping; poll++) {
                await this.update(job.id, { message: t("{p0} is preparing historical transactions…", { p0: connection.institution }) });
                await delay(this.polling.delayMs);
                result = await syncTransactions(this.repository, this.plaid, itemId, job.accountIds, job.range);
              }
              if (result.historyStatus !== 'HISTORICAL_UPDATE_COMPLETE') errors.push(t("{p0}: Historical transactions are still being prepared. Retry later to continue importing.", { p0: connection.institution }));
              for (const account of this.repository.snapshot().accounts.filter((a) => a.itemId === itemId && a.type !== 'investment' && (a.enabled || job.accountIds.includes(a.id)))) readyAccounts.add(account.id);
            } catch (error) { failures.push(error); }
          }
          if (investmentAccounts && products.includes('investments')) {
            try {
              if (job.range.start < historyFloor()) errors.push(t("{p0}: Upstream investment history is usually limited to the last 24 months. Saved older transactions are preserved; other earlier records need manual entry.", { p0: connection.institution }));
              if (job.refresh) {
                try { await this.plaid.refreshInvestments(token); }
                catch (error) { errors.push(t("{p0}: Investment refresh did not complete. Reading existing transactions. {p1}", { p0: connection.institution, p1: safeError(error) })); }
              }
              for (let attempt = 0; ; attempt++) {
                try {
                  const ids = await syncInvestments(this.repository, this.plaid, itemId, job.accountIds, job.range);
                  for (const id of ids) readyAccounts.add(id);
                  break;
                } catch (error) {
                  if (error instanceof PlaidFailure && error.code === 'PRODUCT_NOT_READY' && attempt + 1 < this.polling.attempts && !this.stopping) {
                    await this.update(job.id, { message: t("{p0} is preparing investment transactions…", { p0: connection.institution }) }); await delay(this.polling.delayMs); continue;
                  }
                  throw error;
                }
              }
            } catch (error) { failures.push(error); }
          }
          if (failures.length) {
            for (const failure of failures.slice(1)) errors.push(t('{p0}: {p1}', { p0: connection.institution, p1: safeError(failure) }));
            throw failures[0];
          }
        } catch (error) {
          const message = safeError(error); errors.push(t("{p0}: {p1}", { p0: connection.institution, p1: message }));
          await this.repository.change((draft) => { Object.assign(draft.connections[itemId], { status: error instanceof PlaidFailure && error.code === 'ITEM_LOGIN_REQUIRED' ? 'login_required' : 'error', lastError: message }); }, false);
        }
      }
    } else for (const id of job.accountIds) readyAccounts.add(id);
    if (readyAccounts.size) {
      await this.update(job.id, { status: 'classifying', message: t("Generating the classified ledger…"), progress: 0 });
      const result = await this.publisher([...readyAccounts], job.force, async (done, total) => { await this.update(job.id, { progress: done, total, message: t("Classifying transactions: {p0} / {p1}", { p0: done, p1: total }) }); }, job.range);
      if (result.failed) errors.push(t("{p0} classification batches did not complete. The previous ledger was preserved; classification can be retried.", { p0: result.failed }));
      if (result.errors?.length) errors.push(...result.errors);
    }
    const status = errors.length ? readyAccounts.size ? 'partial_failed' : 'failed' : 'succeeded';
    await this.update(job.id, { status, message: status === 'succeeded' ? t("Ledger updated.") : t("Some steps did not complete. View details and retry."), errors });
  }
  async retry(id: string) {
    const job = this.repository.snapshot().jobs[id];
    if (!job) throw new AppError(t("Task not found."), 404);
    return this.enqueue({ ...job, force: false });
  }
  async idle() { await this.tail; }
  async close() { this.stopping = true; await this.tail; }
}
