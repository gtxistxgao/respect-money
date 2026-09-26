import type { AccountBase, InvestmentsHoldingsGetResponse, Security } from 'plaid';
import { defaultUsdCnyRate } from '../../shared/settings.js';
import { emptyWealth, type AccountBalance, type AssetKind, type WealthSummary } from '../../shared/wealth.js';
import type { RepositoryState } from '../storage/state.js';
import { AppError, cents } from './ledger.js';
import { message as t } from '../../i18n/index.js';

function securityKind(security?: Security): AssetKind {
  if (security?.is_cash_equivalent || security?.type === 'cash') return 'cash';
  if (security?.type === 'equity') return 'stocks';
  if (['etf', 'mutual fund'].includes(security?.type || '')) return 'funds';
  if (security?.type === 'fixed income') return 'bonds';
  return 'investment';
}

export function accountBalance(account: Pick<AccountBase, 'account_id' | 'balances' | 'type'>, fetchedAt: string, holdings?: InvestmentsHoldingsGetResponse): AccountBalance {
  const current = account.balances?.current;
  const debtAccount = account.type === 'credit' || account.type === 'loan';
  const currency = account.balances?.iso_currency_code || account.balances?.unofficial_currency_code || '';
  const value = typeof current === 'number' && Number.isFinite(current) ? cents(current) : null;
  const netCents = value !== null && Number.isSafeInteger(value) ? (debtAccount ? -value : value) : null;
  const investment = account.type === 'investment' || account.type === 'brokerage';
  const fallback: AssetKind = investment ? 'investment' : account.type === 'depository' || debtAccount ? 'cash' : 'other';
  const balance: AccountBalance = { netCents, currency, debtAccount, fetchedAt, allocation: [], allocationIncomplete: investment };
  if (netCents === null || netCents <= 0) return balance;
  balance.allocation = [{ kind: fallback, valueCents: netCents }];
  if (!investment || !holdings) return balance;
  const rows = holdings.holdings.filter((holding) => holding.account_id === account.account_id);
  if (!rows.length) return balance;
  const groups = new Map<AssetKind, number>();
  for (const holding of rows) {
    // Short positions, foreign holdings and inconsistent snapshots cannot form a
    // gross-asset allocation from a net account balance. Keep the account total.
    if (holding.iso_currency_code !== currency || !Number.isFinite(holding.institution_value) || holding.institution_value < 0) return balance;
    const valueCents = cents(holding.institution_value);
    if (!Number.isSafeInteger(valueCents)) return balance;
    const kind = securityKind(holdings.securities.find((security) => security.security_id === holding.security_id));
    groups.set(kind, (groups.get(kind) || 0) + valueCents);
  }
  const total = [...groups.values()].reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total) || total > netCents) return balance;
  if (total < netCents) groups.set('investment', (groups.get('investment') || 0) + netCents - total);
  balance.allocation = [...groups].filter(([, value]) => value > 0).map(([kind, valueCents]) => ({ kind, valueCents }));
  balance.allocationIncomplete = groups.has('investment');
  return balance;
}

export function wealthSummary(state: RepositoryState, refreshing = false): WealthSummary {
  const wealth = state.wealth || emptyWealth();
  const accounts = state.accounts.filter((account) => account.source === 'plaid' && state.connections[account.itemId || '']).map((account) => ({
    id: account.id, name: account.name, mask: account.mask, institution: account.institution, type: account.type,
    included: true, balance: wealth.balances[account.id] || null,
  }));
  let assetsCents = 0; let debtsCents = 0; let missingAccounts = 0;
  const groups = new Map<AssetKind, number>();
  const add = (kind: AssetKind, value: number) => { groups.set(kind, (groups.get(kind) || 0) + value); assetsCents += value; };
  for (const account of accounts.filter((account) => account.included)) {
    const balance = account.balance;
    if (!balance || balance.netCents === null || balance.currency !== 'USD') { missingAccounts++; continue; }
    if (balance.netCents < 0) debtsCents -= balance.netCents;
    else for (const part of balance.allocation) add(part.kind, part.valueCents);
  }
  const assets = wealth.assets.map((asset) => {
    add(asset.kind, asset.valueCents);
    const linked = accounts.find((account) => account.id === asset.debtAccountId);
    const balance = linked?.balance;
    const effectiveDebtCents = asset.debtAccountId
      ? linked?.included && balance?.currency === 'USD' && balance.netCents !== null ? Math.max(0, -balance.netCents) : null
      : asset.debtCents;
    if (!asset.debtAccountId) debtsCents += asset.debtCents;
    else if (!linked?.included) missingAccounts++;
    return { ...asset, effectiveDebtCents, equityCents: effectiveDebtCents === null ? null : asset.valueCents - effectiveDebtCents };
  });
  if (![assetsCents, debtsCents, assetsCents - debtsCents].every(Number.isSafeInteger)) throw new AppError(t('Invalid value.'));
  return {
    usdCnyRate: state.settings?.usdCnyRate ?? defaultUsdCnyRate,
    assetsCents, debtsCents, netWorthCents: assetsCents - debtsCents, missingAccounts,
    allocation: [...groups].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).map(([kind, valueCents]) => ({ kind, valueCents, percent: assetsCents ? valueCents / assetsCents * 100 : 0 })),
    accounts, assets, refreshing, lastAttemptAt: wealth.lastAttemptAt, errors: wealth.errors,
    needsRefresh: (!wealth.lastAttemptAt && Object.keys(state.connections).length > 0) || accounts.some((account) => !account.balance && (!wealth.lastAttemptAt || (state.accounts.find((a) => a.id === account.id)?.createdAt || '') > wealth.lastAttemptAt)),
  };
}
