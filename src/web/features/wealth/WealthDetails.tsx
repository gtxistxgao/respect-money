import { t } from '../../../i18n/index.js';
import type { WealthSummary } from '../../../shared/wealth.js';
import { assetGroupLabels, debtLabels, wealthBreakdown, type WealthEntry } from '../../../shared/wealth-breakdown.js';
import { Modal } from '../../components.js';
import { assetMoney } from './api.js';

export type WealthSelection = { side: 'assets' | 'debts' | 'net'; kind?: string };
function DetailTable({ entries, title, labels }: { entries: WealthEntry[]; title: string; labels: Record<string, string> }) {
  return <section className="wealth-detail-section"><h3>{t(title)}<strong>{assetMoney(entries.reduce((sum, row) => sum + row.valueCents, 0))}</strong></h3>
    {entries.length ? <div className="account-table-scroll" tabIndex={0} role="region" aria-label={t(title)}><table className="account-data-table wealth-detail-table" aria-label={t(title)}>
      <thead><tr><th scope="col">{t('Asset or account')}</th><th scope="col">{t('Data source')}</th><th scope="col">{t('Type')}</th><th scope="col">{t('Amount')}</th></tr></thead>
      <tbody>{entries.map(row => <tr key={row.id}><th scope="row">{row.name}<small className="wealth-detail-source">{row.source === 'manual' ? t('Manual assets') : row.institution}</small>{row.mask && <small>{t('Last four digits')}: {row.mask}</small>}{row.linkedAsset && <small>{t('Linked to {p0}; counted once.', { p0: row.linkedAsset })}</small>}</th><td>{row.source === 'manual' ? t('Manual assets') : row.institution}</td><td>{t(labels[row.kind])}</td><td>{assetMoney(row.valueCents)}</td></tr>)}</tbody>
    </table></div> : <p className="wealth-empty">{t('No items in this breakdown.')}</p>}
  </section>;
}
export function WealthDetails({ data, selection, cny, onClose }: { data: WealthSummary; selection: WealthSelection; cny: (cents: number) => string; onClose: () => void }) {
  const breakdown = wealthBreakdown(data);
  const assets = breakdown.assets.filter(row => !selection.kind || row.kind === selection.kind);
  const debts = breakdown.debts.filter(row => !selection.kind || row.kind === selection.kind);
  const labels: Record<string, string> = selection.side === 'debts' ? debtLabels : assetGroupLabels;
  const title = selection.side === 'net' ? t('Net worth details') : selection.kind ? t('View {p0} details', { p0: t(labels[selection.kind]) }) : t(selection.side === 'assets' ? 'Asset details' : 'Debt details');
  const value = selection.side === 'net' ? data.netWorthCents : (selection.side === 'assets' ? assets : debts).reduce((sum, row) => sum + row.valueCents, 0);
  return <Modal title={title} onClose={onClose} wide><div className="wealth-details">
    <div className="wealth-details-total"><strong>{assetMoney(value)}</strong><small>{cny(value)}</small></div>
    {selection.side !== 'debts' && <DetailTable entries={assets} title="Asset details" labels={assetGroupLabels} />}
    {selection.side !== 'assets' && <DetailTable entries={debts} title="Debt details" labels={debtLabels} />}
    <p className="wealth-footnote">{t('Only items included in the current USD totals are shown. Assets use their gross value; linked debts are counted once.')}</p>
    {data.missingAccounts > 0 && <p className="wealth-footnote">{t('{p0} accounts have missing or non-USD balances and are excluded from these totals.', { p0: data.missingAccounts })}</p>}
  </div></Modal>;
}
