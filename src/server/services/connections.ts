import { message as t } from "../../i18n/index.js";
import { randomUUID } from 'node:crypto';
import { CountryCode, Products, type AccountBase, type Item } from 'plaid';
import { bankingProducts, type BankingProduct, type LinkCompletion } from '../../shared/banking.js';
import type { AppConfig } from '../config.js';
import { AppError } from '../domain/ledger.js';
import type { Account } from '../../shared/models.js';
import type { Repository, RepositoryState } from '../storage/repository.js';
import { PlaidFailure, type PlaidGateway } from '../integrations/plaid/client.js';

export function reconcileAccounts(state: RepositoryState, itemId: string, accounts: AccountBase[], selectedIds?: string[]) {
  const institution = state.connections[itemId]?.institution || 'Bank';
  for (const source of accounts) {
    const mergedInto = state.connections[itemId]?.mergedAccounts?.[source.account_id];
    // Keep the chosen source authoritative for balances and transactions. Only
    // suppress an explicitly merged account while its retained source exists.
    if (mergedInto && state.accounts.some((account) => account.id === mergedInto && account.source === 'plaid' && account.itemId !== itemId && state.connections[account.itemId || ''])) continue;
    const existing = state.accounts.find((account) => account.itemId === itemId && account.plaidAccountId === source.account_id);
    const type: Account['type'] = (source.type === 'investment' || source.type === 'brokerage') ? 'investment' : source.type === 'credit' ? 'credit' : source.type === 'depository' ? source.subtype === 'savings' ? 'savings' : 'checking' : 'other';
    if (existing) { existing.mask = source.mask || ''; existing.type = type; delete existing.disconnectedAt; if (selectedIds) existing.enabled = selectedIds.includes(source.account_id); continue; }
    state.accounts.push({ id: randomUUID(), name: source.name.slice(0, 100), institution, mask: source.mask || '', type, source: 'plaid',
      enabled: selectedIds ? selectedIds.includes(source.account_id) : false, itemId, plaidAccountId: source.account_id, createdAt: new Date().toISOString() });
  }
}
// Consented products may not be initialized yet. Never infer consent from
// available_products alone; that field only describes provider capabilities.
export function supportedProducts(item: Item, requested: readonly BankingProduct[]): BankingProduct[] {
  const consented = new Set<string>(item.consented_products ?? requested);
  const supported = [...(item.products || []), ...(item.billed_products || []), ...(item.available_products || [])];
  const hasCapabilities = item.products !== undefined || item.billed_products !== undefined || item.available_products !== undefined;
  return bankingProducts.filter((product) => consented.has(product) && (!hasCapabilities || supported.includes(product as Products)));
}

function duplicateConnection(state: RepositoryState, input: LinkCompletion) {
  const normalize = (value: string) => value.trim().toLowerCase();
  return Object.values(state.connections).find((connection) => {
    const sameInstitution = connection.institutionId && input.institutionId
      ? connection.institutionId === input.institutionId : normalize(connection.institution) === normalize(input.institution);
    return sameInstitution && input.accounts?.some((candidate) => state.accounts.some((account) => account.itemId === connection.id && (
      account.plaidAccountId === candidate.id || (candidate.mask && account.mask === candidate.mask && normalize(account.name) === normalize(candidate.name))
    )));
  });
}

export class Connections {
  private completionQueue: Promise<unknown> = Promise.resolve();
  constructor(private repository: Repository, private plaid: PlaidGateway, private config: AppConfig) {}
  disconnect(itemId: string) {
    // Serialize with Link completion, and hold the local writer queue during
    // revocation so a new sync or credential change cannot race the removal.
    const operation = this.completionQueue.then(() => this.repository.change(async (state) => {
      const connection = state.connections[itemId];
      if (!connection) throw new AppError(t('Connection not found.'), 404);
      if (Object.values(state.jobs).some(job => ['queued', 'fetching', 'classifying', 'publishing'].includes(job.status))) throw new AppError(t('Wait for synchronization or classification to finish before disconnecting.'), 409);
      const token = state.vault.tokens[itemId];
      if (!token) throw new AppError(t('The local token for this connection is missing. Please reconnect.'), 409);
      const accounts = state.accounts.filter(account => account.itemId === itemId);
      const ids = new Set(accounts.map(account => account.id));
      const linked = state.wealth?.assets.filter(asset => asset.debtAccountId && ids.has(asset.debtAccountId)) || [];
      for (const asset of linked) {
        const balance = state.wealth!.balances[asset.debtAccountId!];
        if (!balance || balance.currency !== 'USD' || balance.netCents === null || !balance.debtAccount || Math.max(0, -balance.netCents) > 1_000_000_000_000) throw new AppError(t('Enter the outstanding debt manually for linked assets before disconnecting.'), 409);
        asset.debtCents = Math.max(0, -balance.netCents); asset.debtAccountId = null; asset.revision++;
      }
      try { await this.plaid.removeItem(token); }
      catch (error) {
        // A previous removal may have succeeded upstream before a local write
        // failed. An already-removed Item is safe to finish cleaning up locally.
        if (!(error instanceof PlaidFailure && error.code === 'ITEM_NOT_FOUND')) throw error;
      }
      delete state.connections[itemId]; delete state.vault.tokens[itemId];
      for (const [id, session] of Object.entries(state.vault.links)) if (session.connectionId === itemId) delete state.vault.links[id];
      const now = new Date().toISOString();
      for (const account of accounts) account.disconnectedAt = now;
      if (state.wealth) {
        for (const id of ids) delete state.wealth.balances[id];
        state.wealth.excludedAccountIds = state.wealth.excludedAccountIds.filter(id => !ids.has(id));
        if (!Object.values(state.connections).some(other => other.institution === connection.institution)) state.wealth.errors = state.wealth.errors.filter(error => error.name !== connection.institution);
      }
      return { ok: true };
    }, false));
    this.completionQueue = operation.catch(() => undefined);
    return operation;
  }
  async createLink(connectionId?: string) {
    const state = this.repository.snapshot();
    if (connectionId && (!state.vault.tokens[connectionId] || !state.connections[connectionId])) throw new AppError(t("Connection not found."), 404);
    let requestedProducts: BankingProduct[] = [...bankingProducts];
    if (connectionId) {
      const { item } = await this.plaid.item(state.vault.tokens[connectionId]);
      // Update mode rejects unsupported products (for example Investments on Amex).
      // Capabilities permit requesting consent; they do not grant access themselves.
      const capabilities = new Set([...(item.products || []), ...(item.billed_products || []), ...(item.available_products || [])]);
      const hasCapabilities = item.products !== undefined || item.billed_products !== undefined || item.available_products !== undefined;
      requestedProducts = bankingProducts.filter(product => hasCapabilities ? capabilities.has(product as Products) : state.connections[connectionId].products.includes(product));
    }
    const result = await this.plaid.createLink({ client_name: 'Respect Money', language: 'en', country_codes: [CountryCode.Us],
      user: { client_user_id: state.vault.userId }, redirect_uri: this.config.plaidRedirectUri || undefined,
      ...(connectionId ? {
        access_token: state.vault.tokens[connectionId], update: { account_selection_enabled: true },
        ...(requestedProducts.length ? { additional_consented_products: requestedProducts as Products[] } : {}),
        // Update mode only gathers consent; initialize transaction history on the first sync.
      } : {
        products: [Products.Transactions], additional_consented_products: [Products.Investments], transactions: { days_requested: 730 },
      }),
    });
    const sessionId = randomUUID();
    await this.repository.change((draft) => {
      if (connectionId && (!draft.connections[connectionId] || draft.vault.tokens[connectionId] !== state.vault.tokens[connectionId])) throw new AppError(t('Connection not found.'), 404);
      for (const [id, session] of Object.entries(draft.vault.links)) if (session.expiresAt < new Date().toISOString()) delete draft.vault.links[id];
      draft.vault.links[sessionId] = { token: result.link_token, requestedProducts, connectionId, isUpdate: Boolean(connectionId), expiresAt: result.expiration };
    }, false);
    return { sessionId, linkToken: result.link_token };
  }
  completeLink(input: LinkCompletion) {
    const operation = this.completionQueue.then(() => this.finishLink(input));
    this.completionQueue = operation.catch(() => undefined);
    return operation;
  }
  private async finishLink(input: LinkCompletion) {
    const state = this.repository.snapshot();
    const session = state.vault.links[input.sessionId];
    if (!session || session.expiresAt < new Date().toISOString()) throw new AppError(t("The authorization session expired. Open the bank connection again."));
    const requestedProducts = session.requestedProducts || (session.product ? [session.product] : []);
    let itemId = session.connectionId;
    if (!itemId) {
      if (!input.publicToken) throw new AppError(t("Authorization is not complete."));
      const duplicate = duplicateConnection(state, input);
      if (duplicate) throw new AppError(t('This account is already connected through {p0}. Use Manage accounts on that connection.', { p0: duplicate.institution }), 409);
      const exchange = await this.plaid.exchange(input.publicToken);
      itemId = exchange.item_id;
      // Persist the exchanged token immediately; account discovery can be retried without creating another Item.
      await this.repository.change((draft) => {
        draft.vault.tokens[exchange.item_id] = exchange.access_token;
        draft.connections[exchange.item_id] ||= { id: exchange.item_id, institution: input.institution, products: [], ...(input.institutionId ? { institutionId: input.institutionId } : {}), status: 'error', createdAt: new Date().toISOString(), requestedHistoryDays: requestedProducts.includes('transactions') ? 730 : undefined };
        draft.vault.links[input.sessionId].connectionId = exchange.item_id;
      }, false);
    }
    const token = this.repository.snapshot().vault.tokens[itemId];
    const result = await this.plaid.accounts(token);
    if (result.item.item_id !== itemId) throw new AppError(t("The bank returned an account that does not match this connection."), 502);
    const selected = input.selectedAccountIds ?? result.accounts.map((a) => a.account_id);
    await this.repository.change((draft) => {
      const before = new Set(draft.accounts.filter((account) => account.itemId === itemId).map((account) => account.id));
      reconcileAccounts(draft, itemId, result.accounts, session.isUpdate ? undefined : selected);
      // Keep local ledger preferences and IDs; enable newly authorized accounts.
      for (const account of draft.accounts.filter((account) => account.itemId === itemId)) {
        if (!before.has(account.id)) account.enabled = selected.includes(account.plaidAccountId!);
        if (!result.accounts.some((source) => source.account_id === account.plaidAccountId)) {
          account.enabled = false;
          if (draft.wealth) delete draft.wealth.balances[account.id];
        }
      }
      const connection = draft.connections[itemId];
      if (!connection.products.includes('transactions') && requestedProducts.includes('transactions')) connection.requestedHistoryDays ??= 730;
      connection.products = supportedProducts(result.item, requestedProducts);
      if (result.item.institution_id) connection.institutionId = result.item.institution_id;
      connection.status = 'connected'; delete connection.lastError;
      delete draft.vault.links[input.sessionId];
    });
    return { connectionId: itemId, accountIds: this.repository.snapshot().accounts.filter((a) => a.itemId === itemId && a.enabled).map((a) => a.id) };
  }
}
