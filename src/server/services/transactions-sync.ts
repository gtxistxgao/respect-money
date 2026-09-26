import { message as t } from "../../i18n/index.js";
import { dateSchema, type DateRange, type RawRecord } from '../../shared/models.js';
import { AppError, mergeRanges, normalize, transactionId } from '../domain/ledger.js';
import { PlaidFailure, type PlaidGateway } from '../integrations/plaid/client.js';
import type { Repository } from '../storage/repository.js';
import { reconcileAccounts } from './connections.js';

export async function syncTransactions(repository: Repository, plaid: PlaidGateway, itemId: string, accountIds: string[], range: DateRange) {
  const initial = repository.snapshot();
  const token = initial.vault.tokens[itemId];
  const startCursor = initial.connections[itemId].cursor;
  if (!token) throw new AppError(t("The local token for this connection is missing. Please reconnect."));
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      let cursor = startCursor; let historyStatus = 'NOT_READY'; let pages = 0;
      const events: { type: 'upsert' | 'remove'; accountId?: string; id: string; payload?: Record<string, unknown> }[] = [];
      const accounts = new Map();
      while (true) {
        if (++pages > 2000) throw new AppError(t("Bank data exceeds the limit for a single synchronization."));
        const page = await plaid.sync(token, cursor);
        for (const account of page.accounts) accounts.set(account.account_id, account);
        for (const tx of [...page.added, ...page.modified]) events.push({ type: 'upsert', id: tx.transaction_id, accountId: tx.account_id, payload: tx as unknown as Record<string, unknown> });
        for (const tx of page.removed) events.push({ type: 'remove', id: tx.transaction_id, accountId: tx.account_id });
        historyStatus = page.transactions_update_status;
        if (page.has_more && page.next_cursor === cursor) throw new AppError(t("Bank pagination did not advance. Existing data was preserved."));
        cursor = page.next_cursor;
        if (!page.has_more) break;
      }
      await repository.change((state) => {
        if (state.connections[itemId].cursor !== startCursor) throw new AppError(t("The connection cursor changed. Please retry synchronization."), 409);
        reconcileAccounts(state, itemId, [...accounts.values()]);
        const itemAccounts = state.accounts.filter((a) => a.itemId === itemId && a.type !== 'investment');
        for (const event of events) {
          if (event.type === 'remove') {
            for (const account of itemAccounts) if (!event.accountId || account.plaidAccountId === event.accountId) delete state.records[transactionId({ source: 'plaid_transactions', accountId: account.id, payload: { transaction_id: event.id } })];
          } else {
            const account = itemAccounts.find((a) => a.plaidAccountId === event.accountId);
            if (!account) continue;
            const record: RawRecord = { accountId: account.id, source: 'plaid_transactions', payload: event.payload! };
            dateSchema.parse(normalize(record).postedDate);
            state.records[transactionId(record)] = record;
          }
        }
        for (const account of itemAccounts) {
          if (accountIds.includes(account.id)) state.ranges[account.id] = mergeRanges([...(state.ranges[account.id] || []), range]);
          if (state.ranges[account.id]?.length && !state.staleAccountIds.includes(account.id)) state.staleAccountIds.push(account.id);
        }
        Object.assign(state.connections[itemId], { cursor, historyStatus, status: 'connected', lastSyncedAt: new Date().toISOString(), lastError: undefined });
      }, false);
      return { historyStatus, changed: events.length };
    } catch (error) {
      if (error instanceof PlaidFailure && error.code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' && attempt < 2) continue;
      throw error;
    }
  }
  throw new AppError(t("Pagination changed repeatedly. Please try again later."));
}
