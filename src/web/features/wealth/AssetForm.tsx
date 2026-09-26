import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import Decimal from 'decimal.js';
import { ExternalLink } from 'lucide-react';
import { t } from '../../../i18n/index.js';
import { today } from '../../../shared/models.js';
import { assetKinds, assetLabels, type AssetKind, type ManualAsset, type WealthAccount } from '../../../shared/wealth.js';
import { api } from '../../api.js';
import { ErrorNotice, Field, Modal } from '../../components.js';
import { Select } from '../../Select.js';
import { assetMoney, refreshWealth } from './api.js';

export function AssetForm({ asset, accounts, assets, onClose }: { asset?: ManualAsset; accounts: WealthAccount[]; assets: ManualAsset[]; onClose: () => void }) {
  const [kind, setKind] = useState<AssetKind>(asset?.kind || 'property');
  const [name, setName] = useState(asset?.name || '');
  const [value, setValue] = useState(asset ? (asset.valueCents / 100).toFixed(2) : '');
  const [debt, setDebt] = useState(asset ? (asset.debtCents / 100).toFixed(2) : '0');
  const [debtAccountId, setDebtAccountId] = useState(asset?.debtAccountId || '');
  const [address, setAddress] = useState(asset?.address || '');
  const [vehicleModel, setVehicleModel] = useState(asset?.vehicleModel || '');
  const [valuationDate, setValuationDate] = useState(asset?.valuationDate || today());
  const save = useMutation({ mutationFn: () => api(asset ? `/wealth/assets/${asset.id}` : '/wealth/assets', {
    method: asset ? 'PUT' : 'POST', body: JSON.stringify({ name, kind, valueCents: new Decimal(value).times(100).toNumber(),
      debtCents: debtAccountId ? 0 : new Decimal(debt).times(100).toNumber(), debtAccountId: debtAccountId || null,
      address: kind === 'property' ? address : '', vehicleModel: kind === 'vehicle' ? vehicleModel : '', valuationDate,
      ...(asset ? { revision: asset.revision } : {}),
    }),
  }), onSuccess: async () => { await refreshWealth(); onClose(); } });
  const debtAccounts = accounts.filter((account) => account.balance?.debtAccount && account.balance.currency === 'USD' && !assets.some((row) => row.id !== asset?.id && row.debtAccountId === account.id));
  const linkedBalance = accounts.find((account) => account.id === debtAccountId)?.balance;
  const effectiveDebt = debtAccountId ? linkedBalance?.netCents == null ? null : Math.max(0, -linkedBalance.netCents) : Math.round(Number(debt) * 100);
  const equity = effectiveDebt === null ? null : Math.round(Number(value) * 100) - effectiveDebt;
  return <Modal title={asset ? t('Edit asset') : t('Add asset')} onClose={onClose}>
    <form className="form-body wealth-form" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <div className="form-grid"><Field label={t('Asset type')}><Select aria-label={t('Asset type')} value={kind} onValueChange={(value) => setKind(value as AssetKind)}>{assetKinds.map((kind) => <option key={kind} value={kind}>{t(assetLabels[kind])}</option>)}</Select></Field>
        <Field label={t('Asset name')}><input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} autoFocus /></Field></div>
      {kind === 'property' && <><Field label={t('Property address (optional)')}><input maxLength={300} value={address} onChange={(event) => setAddress(event.target.value)} autoComplete="off" /></Field>
        <div className="valuation-help"><p>{t('Look up your address on Redfin, then enter the estimate below. Values are saved locally and are not updated automatically.')}</p><a href="https://www.redfin.com/redfin-estimate" target="_blank" rel="noopener noreferrer">{t('Open Redfin Estimate')}<ExternalLink size={12} /></a></div></>}
      {kind === 'vehicle' && <Field label={t('Vehicle brand and model')}><input maxLength={150} placeholder="Toyota RAV4 2022" value={vehicleModel} onChange={(event) => setVehicleModel(event.target.value)} /></Field>}
      <div className="form-grid"><Field label={t('Estimated value (USD)')}><input type="number" inputMode="decimal" required min="0" max="10000000000" step="0.01" value={value} onChange={(event) => setValue(event.target.value)} /></Field>
        <Field label={t('Valuation date')}><input type="date" required min="1900-01-01" max={today()} value={valuationDate} onChange={(event) => setValuationDate(event.target.value)} /></Field></div>
      <Field label={t('Debt source')}><Select aria-label={t('Debt source')} value={debtAccountId} onValueChange={setDebtAccountId}><option value="">{t('Enter debt manually')}</option>{debtAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.mask ? ` · ${account.mask}` : ''}</option>)}{debtAccountId && !debtAccounts.some((account) => account.id === debtAccountId) && <option value={debtAccountId}>{t('Linked account unavailable')}</option>}</Select></Field>
      {debtAccountId ? <p>{t('This account balance is used for equity and counted once in total debts.')}</p> : <><Field label={kind === 'property' ? t('Mortgage balance (USD)') : t('Outstanding debt (USD)')}><input type="number" inputMode="decimal" required min="0" max="10000000000" step="0.01" value={debt} onChange={(event) => setDebt(event.target.value)} /></Field><p>{t('If this debt is already in a connected account, select that account above to avoid counting it twice.')}</p></>}
      <div className="wealth-equity-preview"><span>{t('Equity')}</span><strong>{value && equity !== null && Number.isFinite(equity) ? assetMoney(equity, 2) : '—'}</strong></div>
      <ErrorNotice error={save.error} /><div className="form-actions"><button type="button" className="button secondary" onClick={onClose}>{t('Cancel')}</button><button className="button primary" type="submit" disabled={save.isPending}>{save.isPending ? t('Saving…') : t('Save asset')}</button></div>
    </form>
  </Modal>;
}
