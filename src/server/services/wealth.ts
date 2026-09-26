import type { InvestmentsHoldingsGetResponse } from 'plaid';
import { message as t } from '../../i18n/index.js';
import { today } from '../../shared/models.js';
import { emptyWealth, type WealthHistoryEntry } from '../../shared/wealth.js';
import { AppError } from '../domain/ledger.js';
import { accountBalance, wealthSummary } from '../domain/wealth.js';
import { safeError, type PlaidGateway } from '../integrations/plaid/client.js';
import type { Repository } from '../storage/repository.js';
import { reconcileAccounts } from './connections.js';

export class WealthService {
  private pending?: Promise<void>;
  private error?: string;
  constructor(private repository: Repository, private plaid: PlaidGateway) {}
  summary() {
    const summary = wealthSummary(this.repository.snapshot(), Boolean(this.pending));
    if (this.error) summary.errors.push({ name: '', error: this.error });
    return summary;
  }
  history(): WealthHistoryEntry[] {
    return Object.values(this.repository.snapshot().wealth?.history || {}).sort((a, b) => b.date.localeCompare(a.date)).map(({ date, capturedAt, assetsCents, debtsCents, netWorthCents, partial }) => ({ date, capturedAt, assetsCents, debtsCents, netWorthCents, partial }));
  }
  historical(date: string) {
    const snapshot = this.repository.snapshot().wealth?.history?.[date];
    if (!snapshot) throw new AppError(t('Balance snapshot not found.'), 404);
    return snapshot;
  }
  refresh() {
    if (!this.pending) {
      this.error = undefined;
      this.pending = this.run().catch((error: unknown) => { this.error = safeError(error); }).finally(() => { this.pending = undefined; });
    }
    return { refreshing: true };
  }
  async close() { await this.pending; }
  private async run() {
    const snapshot = this.repository.snapshot();
    const attemptedAt = new Date().toISOString();
    let successfulConnections = 0;
    const refreshedAccounts = new Set<string>();
    const errors: { name: string; error: string; connectionId: string }[] = [];
    for (const connection of Object.values(snapshot.connections)) {
      try {
        const token = snapshot.vault.tokens[connection.id];
        if (!token) throw new AppError(t('Connection not found.'), 404);
        const response = await this.plaid.accounts(token);
        if (response.item.item_id !== connection.id) throw new AppError(t('The bank returned an account that does not match this connection.'), 502);
        let holdings: InvestmentsHoldingsGetResponse | undefined;
        if (connection.products.includes('investments') && response.accounts.some((account) => account.type === 'investment' || account.type === 'brokerage')) {
          try {
            holdings = await this.plaid.holdings(token);
            if (holdings.item.item_id !== connection.id) throw new AppError(t('The bank returned an account that does not match this connection.'), 502);
          } catch (error) {
            holdings = undefined;
            errors.push({ name: connection.institution, error: safeError(error), connectionId: connection.id });
          }
        }
        const fetchedAt = new Date().toISOString();
        const freshIds = await this.repository.change((state) => {
          if (!state.connections[connection.id] || state.vault.tokens[connection.id] !== token || state.connections[connection.id].createdAt !== connection.createdAt) return;
          reconcileAccounts(state, connection.id, response.accounts);
          const wealth = state.wealth ||= emptyWealth();
          for (const account of state.accounts.filter((account) => account.itemId === connection.id)) {
            const source = response.accounts.find((row) => row.account_id === account.plaidAccountId);
            if (!source) {
              // A removed/revoked account must not silently keep contributing its old balance.
              delete wealth.balances[account.id];
              continue;
            }
            const holdingAccount = holdings?.accounts.find((row) => row.account_id === source.account_id);
            wealth.balances[account.id] = accountBalance(holdingAccount || source, fetchedAt, holdings);
          }
          return state.accounts.filter((account) => account.itemId === connection.id && response.accounts.some((source) => source.account_id === account.plaidAccountId)).map((account) => account.id);
        }, false);
        if (freshIds) { successfulConnections++; for (const id of freshIds) refreshedAccounts.add(id); }
      } catch (error) { errors.push({ name: connection.institution, error: safeError(error), connectionId: connection.id }); }
    }
    await this.repository.change((state) => {
      const wealth = state.wealth ||= emptyWealth();
      const currentErrors = errors.filter(error => state.connections[error.connectionId]
        && state.vault.tokens[error.connectionId] === snapshot.vault.tokens[error.connectionId]
        && state.connections[error.connectionId].createdAt === snapshot.connections[error.connectionId].createdAt)
        .map(({ name, error }) => ({ name, error }));
      wealth.lastAttemptAt = attemptedAt; wealth.errors = currentErrors;
      // A completely failed refresh must not replace a good day's snapshot with stale balances.
      const manualOnly = !Object.keys(state.connections).length && (wealth.assets.length > 0 || Object.keys(wealth.history || {}).length > 0);
      if ((successfulConnections && state.accounts.some(a => refreshedAccounts.has(a.id))) || manualOnly) {
        const summary = wealthSummary(state);
        const capturedAt = new Date().toISOString();
        const date = today(new Date(capturedAt));
        const history = wealth.history ||= {};
        history[date] = structuredClone({
          date, capturedAt, usdCnyRate: summary.usdCnyRate,
          assetsCents: summary.assetsCents, debtsCents: summary.debtsCents, netWorthCents: summary.netWorthCents,
          missingAccounts: summary.missingAccounts, partial: currentErrors.length > 0 || summary.missingAccounts > 0,
          accounts: summary.accounts.map((account) => ({ ...account, fresh: refreshedAccounts.has(account.id) })),
          assets: summary.assets, allocation: summary.allocation, errors: currentErrors,
        });
      }
    }, false);
  }
}
