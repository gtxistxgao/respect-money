import { message as t } from "../../../i18n/index.js";
import { Configuration, PlaidApi, PlaidEnvironments, type AccountsGetResponse, type ItemGetResponse, type ItemPublicTokenExchangeResponse, type LinkTokenCreateRequest, type LinkTokenCreateResponse, type TransactionsSyncResponse, type InvestmentsTransactionsGetResponse, type InvestmentsHoldingsGetResponse } from 'plaid';
import type { AppConfig } from '../../config.js';
import type { DateRange } from '../../../shared/models.js';
import { AppError } from '../../domain/ledger.js';

export interface PlaidGateway {
  createLink(request: LinkTokenCreateRequest): Promise<LinkTokenCreateResponse>;
  exchange(publicToken: string): Promise<ItemPublicTokenExchangeResponse>;
  accounts(token: string): Promise<AccountsGetResponse>;
  item(token: string): Promise<ItemGetResponse>;
  sync(token: string, cursor?: string): Promise<TransactionsSyncResponse>;
  refresh(token: string): Promise<void>;
  investments(token: string, range: DateRange, offset: number, accountIds: string[]): Promise<InvestmentsTransactionsGetResponse>;
  refreshInvestments(token: string): Promise<void>;
  holdings(token: string): Promise<InvestmentsHoldingsGetResponse>;
  removeItem(token: string): Promise<void>;
}
const messages: Record<string, string> = {
  ITEM_LOGIN_REQUIRED: t("Bank authorization expired. Reconnect in Settings."),
  PRODUCT_NOT_READY: t("The bank is still preparing data. Please try again later."),
  PRODUCT_NOT_SUPPORTED: t("This account does not support the selected product. You can use a manual account."),
  NO_INVESTMENT_ACCOUNTS: t("No investment accounts were available in this authorization."),
  INVALID_CREDENTIALS: t("Bank login information needs updating. Please reconnect."),
  INVALID_API_KEYS: t("Invalid Plaid credentials. Check the environment and keys."),
  RATE_LIMIT_EXCEEDED: t("Too many Plaid requests. Please try again later."),
  TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION: t("Bank data changed during pagination. Please retry synchronization."),
  INTERNAL_SERVER_ERROR: t("Plaid is temporarily unavailable. Please try again later."),
  INSTITUTION_DOWN: t("The bank is temporarily unavailable. Please try again later."),
};
export class PlaidFailure extends AppError {
  constructor(readonly code: string) { super(messages[code] || t("Plaid request failed ({p0}). Try again later or check account settings.", { p0: code }), 502); }
}
export function safeError(error: unknown) { return error instanceof AppError ? error.localizedMessage : t("The operation could not be completed. Please retry; existing records were preserved."); }

export function createPlaidGateway(config: AppConfig): PlaidGateway {
  const sdk = new PlaidApi(new Configuration({ basePath: PlaidEnvironments[config.plaidEnv], baseOptions: { timeout: 30000, headers: { 'PLAID-CLIENT-ID': config.plaidClientId, 'PLAID-SECRET': config.plaidSecret } } }));
  async function call<T>(operation: () => Promise<{ data: T }>) {
    if (!config.plaidClientId || !config.plaidSecret) throw new AppError(t("Configure Plaid credentials in Settings."));
    try { return (await operation()).data; }
    catch (error) {
      const code = (error as { response?: { data?: { error_code?: unknown } }; code?: unknown }).response?.data?.error_code;
      throw new PlaidFailure(typeof code === 'string' && /^[A-Z0-9_]{1,100}$/.test(code) ? code : 'NETWORK_ERROR');
    }
  }
  return {
    createLink: (request) => call(() => sdk.linkTokenCreate(request)),
    exchange: (publicToken) => call(() => sdk.itemPublicTokenExchange({ public_token: publicToken })),
    accounts: (token) => call(() => sdk.accountsGet({ access_token: token })),
    item: (token) => call(() => sdk.itemGet({ access_token: token })),
    // Covers Transactions added after Link (e.g. an investment-only Item upgraded in update mode).
    // Plaid ignores days_requested when Transactions was already initialized during initial Link.
    sync: (token, cursor) => call(() => sdk.transactionsSync({ access_token: token, cursor: cursor || undefined, count: 500, options: { include_original_description: true, ...(!cursor ? { days_requested: 730 } : {}) } })),
    refresh: async (token) => { await call(() => sdk.transactionsRefresh({ access_token: token })); },
    investments: (token, range, offset, accountIds) => call(() => sdk.investmentsTransactionsGet({ access_token: token, start_date: range.start, end_date: range.end, options: { count: 500, offset, account_ids: accountIds } })),
    holdings: (token) => call(() => sdk.investmentsHoldingsGet({ access_token: token })),
    refreshInvestments: async (token) => { await call(() => sdk.investmentsRefresh({ access_token: token }, { timeout: 60000 })); },
    removeItem: async (token) => { await call(() => sdk.itemRemove({ access_token: token })); },
  };
}
