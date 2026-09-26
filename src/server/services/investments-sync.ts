import { message as t } from "../../i18n/index.js";
import { type DateRange, type RawRecord } from '../../shared/models.js';
import { AppError, inRanges, mergeRanges, normalize, transactionId } from '../domain/ledger.js';
import type { PlaidGateway } from '../integrations/plaid/client.js';
import type { Repository } from '../storage/repository.js';
import { historyFloor } from '../domain/coverage.js';

export async function syncInvestments(repository: Repository, plaid: PlaidGateway, itemId: string, accountIds: string[], requested: DateRange) {
  const state = repository.snapshot();
  const accounts = state.accounts.filter((a) => a.itemId === itemId && a.type === 'investment' && accountIds.includes(a.id));
  if (!accounts.length) throw new AppError(t("Enable at least one investment account. Use a bank connection for ordinary bank cards."));
  const token = state.vault.tokens[itemId];
  if (!token) throw new AppError(t("The local token for this connection is missing. Please reconnect."));
  const fetched = new Map<string, RawRecord>();
  const coverage: Record<string, DateRange[]> = {};
  const reconciled: Record<string, DateRange[]> = {};
  const floor = historyFloor();
  for (const account of accounts) {
    // Reconcile all enabled history too: a narrow sync must not miss corrections in older months.
    const ranges = mergeRanges([...(state.ranges[account.id] || []), requested]);
    coverage[account.id] = ranges;
    reconciled[account.id] = [];
    for (const range of ranges) {
      // Investment history has finite retention. Never erase cached history that aged out upstream.
      if (range.end < floor) continue;
      const fetchRange = { start: range.start < floor ? floor : range.start, end: range.end };
      reconciled[account.id].push(fetchRange);
      let offset = 0; let expected: number | undefined;
      const ids = new Set<string>();
      while (true) {
        if (offset > 100000) throw new AppError(t("Investment transactions exceed the limit for a single synchronization."));
        const page = await plaid.investments(token, fetchRange, offset, [account.plaidAccountId!]);
        if (page.item.item_id !== itemId) throw new AppError(t("The investment connection does not match the request."), 502);
        if (expected !== undefined && expected !== page.total_investment_transactions) throw new AppError(t("Investment transactions changed during pagination. Existing data was preserved; please retry."), 409);
        expected = page.total_investment_transactions;
        if (!Number.isSafeInteger(expected) || expected < 0) throw new AppError(t("The bank returned an invalid investment transaction count."), 502);
        for (const transaction of page.investment_transactions) {
          if (transaction.account_id !== account.plaidAccountId || ids.has(transaction.investment_transaction_id)) throw new AppError(t("Investment pages contain duplicates or mismatched accounts. Please retry."), 409);
          ids.add(transaction.investment_transaction_id);
          const record: RawRecord = { accountId: account.id, source: 'plaid_investments', payload: { ...transaction,
            _security: page.securities.find((security) => security.security_id === transaction.security_id) || null } };
          const normalized = normalize(record);
          if (!inRanges(normalized.postedDate, [fetchRange])) throw new AppError(t("The bank returned investment dates outside the requested range. Existing data was preserved."), 502);
          fetched.set(normalized.id, record);
        }
        offset += page.investment_transactions.length;
        if (offset === expected) break;
        if (offset > expected || !page.investment_transactions.length) throw new AppError(t("Investment pagination is incomplete. Existing data was preserved; please retry."), 502);
      }
    }
  }
  // Nothing is deleted until every page for every reconciled range has succeeded.
  await repository.change((draft) => {
    for (const [id, record] of Object.entries(draft.records)) {
      if (record.source === 'plaid_investments' && reconciled[record.accountId] && inRanges(normalize(record).postedDate, reconciled[record.accountId]) && !fetched.has(id)) delete draft.records[id];
    }
    for (const record of fetched.values()) draft.records[transactionId(record)] = record;
    for (const [accountId, ranges] of Object.entries(coverage)) {
      draft.ranges[accountId] = mergeRanges([...(draft.ranges[accountId] || []), ...ranges]);
      if (!draft.staleAccountIds.includes(accountId)) draft.staleAccountIds.push(accountId);
    }
    Object.assign(draft.connections[itemId], { status: 'connected', historyStatus: 'REQUESTED_RANGES_FETCHED', lastSyncedAt: new Date().toISOString(), lastError: undefined });
  }, false);
  return accounts.map((a) => a.id);
}
