import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { t } from '../../../i18n/index.js';
import { kindLabels, type LedgerRow, type TransactionOverride } from '../../../shared/models.js';
import { Select } from '../../Select.js';
import { api, refreshData } from '../../api.js';

const kinds = ['income', 'expense', 'refund', 'review'] as const;
type EditableKind = typeof kinds[number];

export function InlineKind({ row }: { row: LedgerRow }) {
  const [pending, setPending] = useState<EditableKind | null>(null);
  const [error, setError] = useState('');
  const saving = pending !== null;
  const compatible = (kind: EditableKind) => kind === 'review' || (kind === 'expense' ? row.cashflowCents <= 0 : row.cashflowCents >= 0);
  async function save(kind: EditableKind) {
    if (saving || kind === row.kind || !compatible(kind)) return;
    setPending(kind); setError('');
    try {
      if (row.splitId) {
        const detail = await api<{ version: string; override?: TransactionOverride }>(`/transactions/${row.parentId}`);
        const splits = detail.override?.splits;
        if (detail.version !== row.version || !splits?.some(split => split.id === row.splitId)) throw new Error(t('This transaction was updated. Select the cash flow type again.'));
        await api(`/transactions/${row.parentId}/splits`, { method: 'PUT', body: JSON.stringify({
          version: row.version,
          splits: splits.map(split => split.id === row.splitId ? { ...split, kind, ...(split.kind === 'excluded' ? { excluded: true } : {}) } : split),
        }) });
      } else {
        await api(`/transactions/${row.parentId}/overrides`, { method: 'PUT', body: JSON.stringify({ version: row.version, kind, ...(row.excluded && !row.duplicateOf ? { excluded: true } : {}) }) });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('The cash flow type was not saved. Please retry.'));
    } finally {
      await refreshData(); setPending(null);
    }
  }
  return <div>
    <div className="cashflow-type-cell">
      <div className="cashflow-type-picker"><Select aria-label={t('Change cash flow type for {p0}', { p0: row.description })} title={t('Selecting a cash flow type saves automatically')} value={pending ?? row.kind} disabled={saving} onValueChange={value => void save(value as EditableKind)}>
        {kinds.map(kind => <option key={kind} value={kind} disabled={!compatible(kind)}>{t(kindLabels[kind])}</option>)}
      </Select></div>
      {saving && <LoaderCircle className="spin" size={13} aria-hidden="true" />}
      {(row.excluded || row.categoryExcluded) && <small title={t('Excluded from income and spending')}>{t('Excluded from income and spending')}</small>}
      <span className="sr-only" role="status">{saving ? t('Saving cash flow type…') : ''}</span>
    </div>
    {error && <div className="category-save-error" role="alert">{error}</div>}
  </div>;
}
