import { useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { t } from '../../../i18n/index.js';
import type { CategoryDefinition } from '../../../shared/categories.js';
import { categoryName, useCategories, type CategoryCatalog } from '../../categories.js';
import { api, queryClient, refreshData } from '../../api.js';
import { ErrorNotice, Field } from '../../components.js';
import { Select } from '../../Select.js';

export function Categories({ busy }: { busy: boolean }) {
  const catalog = useCategories();
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  async function change(method: string, id: string | undefined, value: object) {
    if (!catalog.data) return;
    setSaving(true); setError(undefined); setSaved(false);
    try {
      const next = await api<CategoryCatalog>(`/categories${id ? '/' + id : ''}`, { method, body: JSON.stringify({ ...value, revision: catalog.data.revision }) });
      queryClient.setQueryData(['categories'], next); setAdding(false); setSaved(true);
      await refreshData();
    } catch (cause) { setError(cause); } finally { setSaving(false); }
  }
  const disabled = busy || saving || !catalog.data;
  return <section className="settings-section" id="categories" tabIndex={-1}>
    <div className="section-heading"><div><h2>{t('Categories')}</h2><p>{t('Categories describe what a transaction is about. Income, spending and refunds are separate transaction types.')}</p></div><button type="button" className="button secondary" disabled={disabled || adding} onClick={() => { setAdding(true); setSaved(false); }}><Plus size={16} />{t('Add category')}</button></div>
    <p className="muted small">{t('Category prompts guide both AI providers. Changing inclusion updates existing totals immediately; it never changes transaction type or bank amounts.')}</p>
    <ErrorNotice error={error || catalog.error} />
    {Boolean(error) && <button className="button secondary" onClick={() => void catalog.refetch()}>{t('Reload categories')}</button>}
    {saved && <p className="notice" role="status">{t('Categories saved.')}</p>}
    {adding && <CategoryEditor key="new" disabled={disabled} definitions={catalog.definitions} save={value => void change('POST', undefined, value)} cancel={() => setAdding(false)} />}
    <div className="category-settings-list">{catalog.definitions.map(category => <details key={category.id} className="category-settings-item">
      <summary><span>{catalog.label(category.id)}</span><small>{t(category.includeInCashflow ? 'Included in income and spending' : 'Excluded from income and spending')}</small></summary>
      <CategoryEditor key={JSON.stringify(category)} value={category} disabled={disabled} definitions={catalog.definitions} save={value => void change('PUT', category.id, value)} remove={replacement => void change('DELETE', category.id, { replacement })} />
    </details>)}</div>
    {busy && <p className="muted small">{t('Wait for the current synchronization or classification task to finish before saving settings.')}</p>}
  </section>;
}
function CategoryEditor({ value, definitions, disabled, save, remove, cancel }: {
  value?: CategoryDefinition; definitions: CategoryDefinition[]; disabled: boolean;
  save: (value: Omit<CategoryDefinition, 'id'>) => void; remove?: (replacement: string) => void; cancel?: () => void;
}) {
  const [name, setName] = useState(value ? categoryName(value) : '');
  const [prompt, setPrompt] = useState(value?.prompt ?? '');
  const [includeInCashflow, setIncluded] = useState(value?.includeInCashflow ?? true);
  const [deleting, setDeleting] = useState(false);
  const [replacement, setReplacement] = useState('uncategorized');
  function submit(event: FormEvent) { event.preventDefault(); save({ name: value && name === categoryName(value) ? value.name : name, prompt, includeInCashflow }); }
  return <form onSubmit={submit}><fieldset className="category-editor" disabled={disabled}>
    <Field label={t('Category name')}><input value={name} maxLength={80} required onChange={event => setName(event.target.value)} /></Field>
    <Field label={t('AI category instructions')}><textarea value={prompt} rows={3} maxLength={2000} onChange={event => setPrompt(event.target.value)} /></Field>
    <label className="check-row"><input type="checkbox" checked={includeInCashflow} onChange={event => setIncluded(event.target.checked)} />{t('Include this category in income and spending')}</label>
    <div className="configuration-actions"><button className="button primary" type="submit" disabled={!name.trim()}>{t('Save category')}</button>{cancel && <button type="button" className="button secondary" onClick={cancel}>{t('Cancel')}</button>}{remove && value?.id !== 'uncategorized' && <button type="button" className="button secondary" onClick={() => setDeleting(!deleting)}><Trash2 size={14} />{t('Delete category')}</button>}</div>
    {deleting && <div className="category-delete"><p>{t('Existing transactions and rules will move to the selected category. Its inclusion setting will apply. Bank amounts and transaction types stay unchanged.')}</p><Field label={t('Move existing transactions to')}><Select value={replacement} onValueChange={setReplacement}>{definitions.filter(row => row.id !== value?.id).map(row => <option key={row.id} value={row.id}>{categoryName(row)}</option>)}</Select></Field><button type="button" className="button secondary" onClick={() => remove?.(replacement)}>{t('Move transactions and delete category')}</button></div>}
  </fieldset></form>;
}
