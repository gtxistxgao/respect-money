import { Decimal } from 'decimal.js';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Building2, ChevronRight, House, Pencil, Plus, RefreshCw } from 'lucide-react';
import { t, intlLocale } from '../../../i18n/index.js';
import { assetLabels, type ManualAsset, type WealthSummary } from '../../../shared/wealth.js';
import { api } from '../../api.js';
import { ErrorNotice, Loading, Modal } from '../../components.js';
import { assetMoney, refreshWealth } from './api.js';
import { BalanceHistory } from './BalanceHistory.js';
import { wealthPages, type WealthPage } from './WealthNavigation.js';
import { AccountBalancesTable } from './AccountBalancesTable.js';
import { AssetForm } from './AssetForm.js';
import { AllocationPanel } from './AllocationPanel.js';
import { WealthDetails, type WealthSelection } from './WealthDetails.js';
import { assetGroupLabels, debtLabels, wealthBreakdown, type AssetGroup, type DebtKind } from '../../../shared/wealth-breakdown.js';

const colors: Record<AssetGroup, string> = { account_checking: '#79b8ed', account_savings: '#67c9c1', account_investment: '#3fb950', account_credit: '#e39aab', account_cash: '#b4a4e8', account_other: '#829bc9', cash: '#79b8ed', stocks: '#3fb950', funds: '#b4a4e8', bonds: '#67c9c1', property: '#d9a441', vehicle: '#e39aab', investment: '#829bc9', other: '#a1adbd' };

const debtColors: Record<DebtKind, string> = { mortgage: '#d9a441', vehicle_loan: '#e39aab', credit: '#f4635b', overdraft: '#b4a4e8', loan: '#829bc9', other: '#a1adbd' };

function receivedAt(value: string) {
  return new Intl.DateTimeFormat(intlLocale(), { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}
export function Wealth({ view = 'overview' }: { view?: WealthPage }) {
  const page = wealthPages[view];
  const query = useQuery({ queryKey: ['wealth'], queryFn: () => api<WealthSummary>('/wealth'), refetchInterval: (query) => query.state.data?.refreshing ? 1000 : 30000 });
  const refresh = useMutation({ mutationFn: () => api('/wealth/refresh', { method: 'POST' }), onSuccess: refreshWealth });
  const attempted = useRef(false);
  const { mutate } = refresh;
  useEffect(() => {
    if (view !== 'history' && query.data?.needsRefresh && !query.data.refreshing && !attempted.current) { attempted.current = true; mutate(); }
  }, [query.data, mutate, view]);
  const [editing, setEditing] = useState<ManualAsset | 'new' | null>(null);
  const [removing, setRemoving] = useState<ManualAsset | null>(null);
  const remove = useMutation({ mutationFn: (asset: ManualAsset) => api(`/wealth/assets/${asset.id}`, { method: 'DELETE', body: JSON.stringify({ revision: asset.revision }) }), onSuccess: async () => { setRemoving(null); await refreshWealth(); } });
  const [selection, setSelection] = useState<WealthSelection | null>(null);
  const data = query.data;
  const breakdown = data ? wealthBreakdown(data) : undefined;
  const cny = (cents: number) => {
    const yuan = new Decimal(cents).times(data!.usdCnyRate).div(100);
    const format = (value: Decimal) => new Intl.NumberFormat(intlLocale(), { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber());
    return t('Approx. {p0} CNY ({p1} × 10,000)', { p0: format(yuan), p1: format(yuan.div(10000)) });
  };
  return <main className="wealth-main">
    <div className="page-heading"><div><h1>{t(page.title)}</h1><p>{t(page.description)}</p></div><div className="heading-actions">
      <button className="button secondary" disabled={refresh.isPending || data?.refreshing} onClick={() => refresh.mutate()}><RefreshCw size={14} className={data?.refreshing ? 'spin' : ''} />{data?.refreshing ? t('Updating assets…') : t('Update balances')}</button>
      {view === 'overview' && <button className="button primary" onClick={() => setEditing('new')}><Plus size={15} />{t('Add asset')}</button>}
    </div></div>
    <ErrorNotice error={query.error || refresh.error} />
    {view === 'history' ? <BalanceHistory refreshing={Boolean(data?.refreshing)} /> : !data ? query.isPending && <Loading /> : <>
      {view === 'overview' && <>
      <section className="wealth-totals" aria-label={t('Asset summary')}>
        <button className="wealth-total-button" aria-label={t('Asset details')} onClick={() => setSelection({ side: 'assets' })}><span>{t('Total assets')}<ChevronRight size={12} aria-hidden="true" /></span><strong data-testid="total-assets">{assetMoney(data.assetsCents)}</strong><small className="wealth-cny" data-testid="total-assets-cny">{cny(data.assetsCents)}</small></button>
        <button className="wealth-total-button" aria-label={t('Debt details')} onClick={() => setSelection({ side: 'debts' })}><span>{t('Total debts')}<ChevronRight size={12} aria-hidden="true" /></span><strong data-testid="total-debts">{assetMoney(data.debtsCents)}</strong><small className="wealth-cny">{cny(data.debtsCents)}</small></button>
        <button className="wealth-net wealth-total-button" aria-label={t('Net worth details')} onClick={() => setSelection({ side: 'net' })}><span>{t('Net worth')} <small>USD</small></span><strong data-testid="net-worth">{assetMoney(data.netWorthCents)}</strong><small className="wealth-cny" data-testid="net-worth-cny">{cny(data.netWorthCents)}</small><small>{t('Assets minus debts')} <ChevronRight size={12} aria-hidden="true" /></small></button>
      </section>
      </>}
      <div className="wealth-context"><Link to="/settings#currency">{t('1 USD = {p0} CNY', { p0: data.usdCnyRate })}</Link><span>{t('Known USD balances and manual estimates. Bank balances may be delayed.')}</span>{data.lastAttemptAt && <span>{t('Last request: {p0} PT', { p0: receivedAt(data.lastAttemptAt) })}</span>}</div>
      {data.missingAccounts > 0 && <div className="notice" role="status">{t('{p0} accounts have missing or non-USD balances and are excluded from these totals.', { p0: data.missingAccounts })}</div>}
      {data.errors.length > 0 && <div className="notice notice-error" role="alert"><div><strong>{t('Some balances or holdings could not be updated. Previous balances are retained.')}</strong>{data.errors.map((error, index) => <p key={index}>{error.name}{error.name && ': '}{error.error}</p>)}</div></div>}
      {view === 'overview' ? <>
      <div className="wealth-columns">
        <AllocationPanel id="allocation-title" title="Asset allocation" caption="By account type" parts={breakdown!.assetAllocation} labels={assetGroupLabels} colors={colors} empty="Connect an account or add an asset to see your allocation." footnote="Accounts are grouped by type using their full positive USD balances, without splitting holdings. Manual assets use their entered types and gross values." onSelect={kind => setSelection({ side: 'assets', kind })} />
        <AllocationPanel id="debt-allocation-title" title="Debt allocation" caption="By outstanding balance" parts={breakdown!.debtAllocation} labels={debtLabels} colors={debtColors} empty="No debts in the current totals." footnote="Includes account debt and manual loans. Linked loans are counted once." onSelect={kind => setSelection({ side: 'debts', kind })} />
      </div>
      <section className="wealth-panel" aria-labelledby="manual-assets-title"><div className="wealth-section-heading"><h2 id="manual-assets-title">{t('Manual assets')}</h2><span>{t('{p0} assets', { p0: data.assets.length })}</span></div>
        {data.assets.length ? <div className="manual-assets">{data.assets.map((asset) => {
          const rows = [
            { label: 'Estimated value', cents: asset.valueCents },
            { label: asset.kind === 'property' ? 'Mortgage balance' : 'Outstanding debt', cents: asset.effectiveDebtCents },
            { label: 'Equity', cents: asset.equityCents },
          ];
          return <article className="manual-asset" key={asset.id} aria-label={asset.name}>
            <div className="manual-asset-heading"><h3 title={asset.name}>{asset.name}</h3><span>{t(assetLabels[asset.kind])}</span><button className="icon-button" onClick={() => setEditing(asset)} aria-label={t('Edit {p0}', { p0: asset.name })}><Pencil size={13} /></button><button className="text-button" onClick={() => { remove.reset(); setRemoving(asset); }} aria-label={t('Remove {p0}', { p0: asset.name })}>{t('Remove')}</button></div>
            <div className="account-table-scroll" tabIndex={0} role="region" aria-label={asset.name}>
              <table className="manual-asset-table" aria-label={asset.name}><tbody>{rows.map((row) => <tr key={row.label}><th scope="row">{t(row.label)}</th><td>{row.cents === null ? '—' : assetMoney(row.cents)}</td><td className="wealth-cny">{row.cents === null ? '—' : cny(row.cents)}</td></tr>)}</tbody></table>
            </div>
            <div className="asset-footer">{asset.kind === 'property' && asset.address && <span>{asset.address}</span>}{asset.kind === 'vehicle' && asset.vehicleModel && <span>{asset.vehicleModel}</span>}<span>{t('Valued on {p0}', { p0: asset.valuationDate })}</span>{asset.debtAccountId && <span>{t('Debt linked to account; counted once.')}</span>}</div>
          </article>;
        })}</div> : <div className="wealth-empty"><House size={25} /><p>{t('Add your home, car, cash or an account that cannot be connected.')}</p><button className="button secondary" onClick={() => setEditing('new')}><Plus size={14} />{t('Add asset')}</button></div>}
      </section>
      </> : <section className="wealth-panel wealth-balances" aria-label={t('Account balances')}>
        <div className="wealth-balances-body">
          {data.accounts.length ? <AccountBalancesTable accounts={data.accounts} label={t('Account balances')} /> : <div className="wealth-empty"><Building2 size={25} /><p>{t('Connected accounts appear here, including accounts hidden from the ledger.')}</p><Link to="/settings">{t('Connect accounts')}</Link></div>}
          <div className="wealth-balances-footer"><Link to="/settings">{t('Manage accounts')}</Link></div>
        </div>
      </section>}
    </>}
    {selection && data && <WealthDetails data={data} selection={selection} cny={cny} onClose={() => setSelection(null)} />}
    {editing && <AssetForm asset={editing === 'new' ? undefined : editing} accounts={data?.accounts || []} assets={data?.assets || []} onClose={() => setEditing(null)} />}
    {removing && <Modal title={t('Remove asset')} onClose={() => setRemoving(null)}><div className="form-body"><p>{t('Remove {p0} from your assets? This does not delete bank accounts or transactions.', { p0: removing.name })}</p><ErrorNotice error={remove.error} /><div className="form-actions"><button className="button secondary" onClick={() => setRemoving(null)}>{t('Cancel')}</button><button className="button secondary danger-text" disabled={remove.isPending} onClick={() => remove.mutate(removing)}>{t('Remove asset')}</button></div></div></Modal>}
  </main>;
}
