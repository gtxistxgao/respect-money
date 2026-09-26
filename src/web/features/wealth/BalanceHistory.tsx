import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { t, intlLocale } from '../../../i18n/index.js';
import type { WealthHistoryEntry, WealthSnapshot } from '../../../shared/wealth.js';
import { api } from '../../api.js';
import { ErrorNotice, Loading } from '../../components.js';
import { AccountBalancesTable } from './AccountBalancesTable.js';
import { assetMoney } from './api.js';
import { Select } from '../../Select.js';
import { BalanceTrends } from './BalanceTrends.js';

function timestamp(value: string) {
  return new Intl.DateTimeFormat(intlLocale(), { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
export function BalanceHistory({ refreshing }: { refreshing: boolean }) {
  const [selected, setSelected] = useState('');
  const queryClient = useQueryClient();
  useEffect(() => { if (!refreshing) void queryClient.invalidateQueries({ queryKey: ['wealth', 'history'] }); }, [refreshing, queryClient]);
  const history = useQuery({ queryKey: ['wealth', 'history'], queryFn: () => api<WealthHistoryEntry[]>('/wealth/history'), refetchInterval: refreshing ? 1000 : false });
  const date = history.data?.some(entry => entry.date === selected) ? selected : history.data?.[0]?.date;
  const detail = useQuery({ queryKey: ['wealth', 'history', date], queryFn: () => api<WealthSnapshot>(`/wealth/history/${date}`), enabled: Boolean(date), refetchInterval: refreshing ? 1000 : false });
  const snapshot = detail.data;
  return <section className="wealth-panel wealth-history" aria-label={t('Balance history')}>
    <div className="wealth-history-body">
      {history.data?.length ? <BalanceTrends history={history.data} selected={date!} onSelect={setSelected} /> : null}
      <p className="wealth-footnote">{t('Each balance update saves a local snapshot. One per Pacific date; updates on the same day replace it. Earlier dates are not backfilled.')}</p>
      <ErrorNotice error={history.error || detail.error} />
      {history.isPending ? <Loading /> : history.data?.length === 0 ? <p className="wealth-empty">{t('No balance history yet. Update balances to save the first snapshot.')}</p> : history.data?.length ? <>
        <div className="wealth-history-toolbar"><label>{t('Snapshot date (Pacific)')}<Select value={date || ''} onValueChange={setSelected}>{history.data.map((entry) => <option key={entry.date} value={entry.date}>{entry.date}{entry.partial ? ` · ${t('Partial update')}` : ''}</option>)}</Select></label></div>
        {detail.isPending ? <Loading /> : snapshot && <>
          <dl className="wealth-history-totals"><div><dt>{t('Net worth')}</dt><dd>{assetMoney(snapshot.netWorthCents)}</dd></div><div><dt>{t('Total assets')}</dt><dd>{assetMoney(snapshot.assetsCents)}</dd></div><div><dt>{t('Total debts')}</dt><dd>{assetMoney(snapshot.debtsCents)}</dd></div></dl>
          <p className="wealth-footnote">{t('Saved {p0} PT', { p0: timestamp(snapshot.capturedAt) })} · {t('1 USD = {p0} CNY', { p0: snapshot.usdCnyRate })}</p>
          {snapshot.partial && <p className="notice">{t('This snapshot contains missing balances, non-USD accounts or an incomplete update. Some values may be from an earlier refresh.')}</p>}
          <AccountBalancesTable accounts={snapshot.accounts} label={t('Historical account balances')} />
          {snapshot.assets.length > 0 && <table className="wealth-balance-table wealth-history-table" aria-label={t('Historical manual assets')}><thead><tr><th scope="col">{t('Manual assets')}</th><th scope="col" className="wealth-balance-cell">{t('Equity')}</th></tr></thead><tbody>{snapshot.assets.map((asset) => <tr key={asset.id}><th scope="row" className="wealth-account-name"><strong>{asset.name}</strong><small>{t('Estimated value')}: {assetMoney(asset.valueCents)}</small><small>{t('Outstanding debt')}: {asset.effectiveDebtCents === null ? '—' : assetMoney(asset.effectiveDebtCents)}</small></th><td className="wealth-balance-cell"><strong>{asset.equityCents === null ? '—' : assetMoney(asset.equityCents)}</strong></td></tr>)}</tbody></table>}
        </>}
      </> : null}
    </div>
  </section>;
}
