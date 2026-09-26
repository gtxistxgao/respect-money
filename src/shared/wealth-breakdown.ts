import type { Account } from './models.js';
import { assetLabels, type AssetKind, type WealthSummary } from './wealth.js';

export type AssetGroup = AssetKind | `account_${Account['type']}`;
export const assetGroupLabels: Record<AssetGroup, string> = {
  ...assetLabels, account_checking: 'Checking', account_savings: 'Savings',
  account_investment: 'Investment account', account_credit: 'Credit card surplus',
  account_cash: 'Cash accounts', account_other: 'Other accounts',
};

export type DebtKind = 'mortgage' | 'vehicle_loan' | 'credit' | 'overdraft' | 'loan' | 'other';
export const debtLabels: Record<DebtKind, string> = { mortgage: 'Mortgages', vehicle_loan: 'Vehicle loans', credit: 'Credit card debt', overdraft: 'Overdrafts', loan: 'Other loans', other: 'Other debts' };
export type WealthEntry<K extends string = string> = { id: string; name: string; institution: string; mask: string; source: 'account' | 'manual'; kind: K; valueCents: number; linkedAsset?: string };
const manualDebtKind = (kind: AssetKind): DebtKind => kind === 'property' ? 'mortgage' : kind === 'vehicle' ? 'vehicle_loan' : 'other';

// Use the same included USD balances as the summary. Linked debt belongs to
// its account, never to both the account and the manually entered asset.
export function wealthBreakdown(data: Pick<WealthSummary, 'accounts' | 'assets'>) {
  const assets: WealthEntry<AssetGroup>[] = [];
  const debts: WealthEntry<DebtKind>[] = [];
  for (const account of data.accounts) {
    const balance = account.balance;
    if (!account.included || !balance || balance.netCents === null || balance.currency !== 'USD') continue;
    const base = { id: account.id, name: account.name, institution: account.institution, mask: account.mask, source: 'account' as const };
    if (balance.netCents < 0) {
      const linked = data.assets.find(asset => asset.debtAccountId === account.id);
      const kind = linked ? manualDebtKind(linked.kind) : account.type === 'credit' ? 'credit' : balance.debtAccount ? 'loan' : ['checking', 'savings'].includes(account.type || '') ? 'overdraft' : 'other';
      debts.push({ ...base, kind, valueCents: -balance.netCents, ...(linked ? { linkedAsset: linked.name } : {}) });
    } else if (balance.netCents > 0) {
      // One entry per account, using its full balance even when holdings are unavailable.
      assets.push({ ...base, kind: `account_${account.type || 'other'}`, valueCents: balance.netCents });
    }
  }
  for (const asset of data.assets) {
    const base = { id: asset.id, name: asset.name, institution: '', mask: '', source: 'manual' as const };
    if (asset.valueCents > 0) assets.push({ ...base, kind: asset.kind, valueCents: asset.valueCents });
    if (!asset.debtAccountId && asset.debtCents > 0) debts.push({ ...base, kind: manualDebtKind(asset.kind), valueCents: asset.debtCents });
  }
  assets.sort((a, b) => b.valueCents - a.valueCents || a.id.localeCompare(b.id));
  debts.sort((a, b) => b.valueCents - a.valueCents || a.id.localeCompare(b.id));
  const groups = new Map<DebtKind, number>();
  for (const debt of debts) groups.set(debt.kind, (groups.get(debt.kind) || 0) + debt.valueCents);
  const total = debts.reduce((sum, debt) => sum + debt.valueCents, 0);
  const debtAllocation = [...groups].sort((a, b) => b[1] - a[1]).map(([kind, valueCents]) => ({ kind, valueCents, percent: total ? valueCents / total * 100 : 0 }));
  const assetGroups = new Map<AssetGroup, number>();
  for (const asset of assets) assetGroups.set(asset.kind, (assetGroups.get(asset.kind) || 0) + asset.valueCents);
  const assetTotal = assets.reduce((sum, asset) => sum + asset.valueCents, 0);
  const assetAllocation = [...assetGroups].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([kind, valueCents]) => ({ kind, valueCents, percent: assetTotal ? valueCents / assetTotal * 100 : 0 }));
  return { assets, debts, assetAllocation, debtAllocation };
}
