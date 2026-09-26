import { useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { t, intlLocale } from '../../../i18n/index.js';
import type { WealthAccount } from '../../../shared/wealth.js';
import { money } from '../../api.js';
import { assetMoney } from './api.js';

type Row = WealthAccount & { fresh?: boolean };
type SortKey = 'institution' | 'name' | 'mask' | 'type' | 'balance' | 'updated';
const columns: { key: SortKey; label: string }[] = [
  { key: 'institution', label: 'Institution name' }, { key: 'name', label: 'Account name' },
  { key: 'mask', label: 'Last four digits' }, { key: 'type', label: 'Account type' },
  { key: 'balance', label: 'Balance' }, { key: 'updated', label: 'Updated (PT)' },
];
const typeLabels: Record<NonNullable<WealthAccount['type']>, string> = { checking: 'Checking', savings: 'Savings', credit: 'Credit card', investment: 'Investment account', cash: 'Cash', other: 'Other' };
const institutionKey = (account: Row) => account.institution.trim().toLowerCase();

export function AccountBalancesTable({ accounts, label }: { accounts: Row[]; label: string }) {
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: 'institution', descending: false });
  const collator = new Intl.Collator(intlLocale(), { numeric: true, sensitivity: 'base' });
  const typeName = (account: Row) => account.type ? t(typeLabels[account.type]) : null;
  const value = (account: Row): string | number | null => {
    switch (sort.key) {
      case 'institution': return institutionKey(account);
      case 'name': return account.name;
      case 'mask': return account.mask || null;
      case 'type': return typeName(account);
      case 'balance': return account.balance?.netCents ?? null;
      case 'updated': return account.balance ? Date.parse(account.balance.fetchedAt) : null;
    }
  };
  const rows = [...accounts].sort((a, b) => {
    const left = value(a); const right = value(b);
    // Keep unavailable values last in either direction; compare money and dates numerically.
    if (left === null && right !== null) return 1;
    if (right === null && left !== null) return -1;
    const order = left === null || right === null ? 0 : typeof left === 'number' && typeof right === 'number' ? left - right : collator.compare(String(left), String(right));
    return order * (sort.descending ? -1 : 1) || collator.compare(institutionKey(a), institutionKey(b)) || collator.compare(a.name, b.name) || collator.compare(a.mask, b.mask) || a.id.localeCompare(b.id);
  });
  const institutions = [...new Set(accounts.map(institutionKey))].sort(collator.compare);
  const stamp = new Intl.DateTimeFormat(intlLocale(), { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return <div className="account-table-scroll wealth-accounts-scroll" role="region" aria-label={label} tabIndex={0}>
    <table className="account-data-table wealth-accounts-table" aria-label={label}>
      <thead><tr>{columns.map((column) => {
        const active = sort.key === column.key;
        const Icon = active ? sort.descending ? ArrowDown : ArrowUp : ArrowUpDown;
        return <th key={column.key} scope="col" className={`account-col-${column.key}`} aria-sort={active ? sort.descending ? 'descending' : 'ascending' : 'none'}><button onClick={() => setSort({ key: column.key, descending: active ? !sort.descending : false })}>{t(column.label)}<Icon size={12} aria-hidden="true" /></button></th>;
      })}</tr></thead>
      <tbody>{rows.map((account, index) => {
        const balance = account.balance;
        const key = institutionKey(account);
        const groupStart = index > 0 && institutionKey(rows[index - 1]) !== key;
        return <tr key={account.id} className={`institution-tone-${institutions.indexOf(key) % 3}${groupStart ? ' institution-start' : ''}`}>
          <td className="account-col-institution">{account.institution}</td>
          <th scope="row" className="account-col-name">{account.name}{!account.included && <small>{t('Excluded')}</small>}</th>
          <td className="account-col-mask">{account.mask || '—'}</td>
          <td className="account-col-type">{typeName(account) || '—'}</td>
          <td className={`account-col-balance${(balance?.netCents ?? 0) < 0 ? ' debt-text' : ''}`}>{balance?.netCents == null ? '—' : balance.currency === 'USD' ? assetMoney(balance.netCents, 2) : money(balance.netCents, balance.currency)}{balance?.currency && balance.currency !== 'USD' && <small>{t('Not in USD totals')}</small>}</td>
          <td className="account-col-updated">{balance ? <time dateTime={balance.fetchedAt}>{stamp.format(new Date(balance.fetchedAt))}</time> : '—'}{account.fresh === false && <small>{t('Not refreshed in this snapshot')}</small>}</td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
