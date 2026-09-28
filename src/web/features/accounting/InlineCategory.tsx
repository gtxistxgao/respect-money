import { Select } from '../../Select.js';
import { t } from "../../../i18n/index.js";
import { useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { categoryOptions, kindLabels, nonCashflowCategoryKind, type Category, type LedgerRow, type TransactionOverride } from '../../../shared/models.js';
import { api, refreshData } from '../../api.js';

export function InlineCategory({ row }: { row: LedgerRow }) {
  const [pending, setPending] = useState<Category | null>(null);
  const [error, setError] = useState('');
  const saving = pending !== null;

  async function save(category: Category) {
    if (saving || category === row.category) return;
    setPending(category); setError('');
    try {
      if (row.splitId) {
        const detail = await api<{ version: string; override?: TransactionOverride }>(`/transactions/${row.parentId}`);
        const splits = detail.override?.splits;
        if (detail.version !== row.version || !splits?.some((split) => split.id === row.splitId)) {
          throw new Error(t("This transaction was updated. Select the category again."));
        }
        await api(`/transactions/${row.parentId}/splits`, { method: 'PUT', body: JSON.stringify({
          version: row.version, splits: splits.map((split) => split.id === row.splitId ? { ...split, category } : split),
        }) });
      } else {
        await api(`/transactions/${row.parentId}/overrides`, { method: 'PUT', body: JSON.stringify({ version: row.version, category }) });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("The category was not saved. Please retry."));
    } finally {
      await refreshData();
      setPending(null);
    }
  }

  return <div>
    <div className="category-cell">
      <span className={`category-dot dot-${pending ?? row.category}`} />
      <div>
        <div className="category-picker">
          <Select aria-label={t("Change category for {p0}", { p0: row.description })} title={t("Selecting a category saves automatically")} value={pending ?? row.category} disabled={saving} onValueChange={(nextValue) => void save(nextValue as Category)}>
            {categoryOptions.map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}
          </Select>
        </div>
        {!['income', 'expense', 'refund'].includes(row.kind) && <small>{nonCashflowCategoryKind(row.category) === row.kind ? t("Excluded from income and spending") : kindLabels[row.kind]}</small>}
      </div>
      {saving ? <LoaderCircle className="spin" size={13} aria-hidden="true" /> : row.classificationSource === 'manual' && <Check size={13} aria-label={t("Manually confirmed")} />}
      <span className="sr-only" role="status">{saving ? t("Saving category…") : ''}</span>
    </div>
    {error && <div className="category-save-error" role="alert">{error}</div>}
  </div>;
}
