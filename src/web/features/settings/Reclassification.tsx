import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, Pencil, Plus, ScanSearch, Trash2 } from 'lucide-react';
import { t } from '../../../i18n/index.js';
import { useCategories } from '../../categories.js';
import type { ReclassificationPreview, ReclassificationRule, ReclassificationRuleInput } from '../../../shared/reclassification.js';
import { api, money, queryClient, refreshData } from '../../api.js';
import { ErrorNotice, Field } from '../../components.js';
import { Select } from '../../Select.js';

const emptyRule: ReclassificationRuleInput = { example: '', category: 'uncategorized', direction: 'outgoing' };
const previewKey = ['reclassification-preview'];

export function Reclassification({ busy }: { busy: boolean }) {
  const { options: categoryOptions, label: categoryLabel } = useCategories();
  const rules = useQuery({ queryKey: ['reclassification-rules'], queryFn: () => api<ReclassificationRule[]>('/reclassification/rules') });
  const preview = useQuery({ queryKey: previewKey, queryFn: () => api<ReclassificationPreview | null>('/reclassification/previews/latest'), refetchInterval: (query) => query.state.data?.status === 'scanning' ? 1000 : false });
  const exampleInput = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(emptyRule);
  const [editing, setEditing] = useState<ReclassificationRule>();
  const [operation, setOperation] = useState('');
  const [error, setError] = useState<unknown>();
  const [selection, setSelection] = useState<{ id: string; excluded: Set<string> }>({ id: '', excluded: new Set() });
  const [page, setPage] = useState(1);
  const result = preview.data;
  const scanning = result?.status === 'scanning';
  const disabled = busy || Boolean(operation) || scanning;
  const excluded = selection.id === result?.id ? selection.excluded : new Set<string>();
  const selected = result?.matches.filter((row) => !excluded.has(row.id)) || [];
  const pageCount = Math.max(1, Math.ceil((result?.matches.length || 0) / 50));
  const currentPage = Math.min(page, pageCount);
  async function act(name: string, action: () => Promise<void>) {
    setOperation(name); setError(undefined);
    try { await action(); } catch (error) { setError(error); } finally { setOperation(''); }
  }
  function reset() { setDraft(emptyRule); setEditing(undefined); }
  async function save() {
    await act('save', async () => {
      await api(`/reclassification/rules${editing ? '/' + editing.id : ''}`, { method: editing ? 'PUT' : 'POST', body: JSON.stringify({ ...draft, ...(editing ? { revision: editing.revision } : {}) }) });
      reset(); await refreshData();
    });
  }
  async function scan(rule: ReclassificationRule) {
    await act(rule.id, async () => {
      const started = await api<ReclassificationPreview>(`/reclassification/rules/${rule.id}/preview`, { method: 'POST' });
      setSelection({ id: started.id, excluded: new Set() }); setPage(1);
      queryClient.setQueryData(previewKey, started);
    });
  }
  async function apply() {
    if (!result) return;
    await act('apply', async () => {
      await api(`/reclassification/previews/${result.id}/apply`, { method: 'POST', body: JSON.stringify({ transactionIds: selected.map((row) => row.id) }) });
      await refreshData();
    });
  }
  return <section className="settings-section reclassification-section" id="reclassification" tabIndex={-1}>
    <div className="section-heading"><div><h2>{t('Reclassify')}</h2><p>{t('Find similar transactions using examples, then assign your chosen category.')}</p></div></div>
    <ErrorNotice error={error || rules.error || preview.error} />
    <div className="reclassification-form">
      <Field label={t('Transaction examples or pattern')}><textarea ref={exampleInput} aria-label={t('Transaction examples or pattern')} rows={3} maxLength={2000} value={draft.example} disabled={disabled} placeholder={t('Example: Send to Alex Morgan, about $500. Ignore changing reference IDs.')} onChange={(event) => setDraft({ ...draft, example: event.target.value })} /></Field>
      <div className="reclassification-options">
        <Field label={t('Target category')}><Select value={draft.category} disabled={disabled} onValueChange={(category) => setDraft({ ...draft, category: category as ReclassificationRuleInput['category'] })}>{categoryOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</Select></Field>
        <Field label={t('Cash flow direction')}><Select value={draft.direction} disabled={disabled} onValueChange={(direction) => setDraft({ ...draft, direction: direction as ReclassificationRuleInput['direction'] })}><option value="outgoing">{t('Money sent')}</option><option value="incoming">{t('Money received')}</option><option value="all">{t('Both directions')}</option></Select></Field>
      </div>
    </div>
    <p className="reclassification-help">{t('Paste one or more examples, or describe the recipient, recurring text and amount. Reference IDs may differ; “about” an amount allows up to 10% variation.')}</p>
    <div className="reclassification-actions"><button className="button primary" onClick={() => void save()} disabled={disabled || draft.example.trim().length < 3}><Plus size={14} />{operation === 'save' ? t('Saving…') : editing ? t('Save rule') : t('Add rule')}</button>{editing && <button className="button secondary" onClick={reset} disabled={Boolean(operation)}>{t('Cancel')}</button>}</div>
    <p className="reclassification-help">{t('Rules use your selected AI provider to find similar transactions. Applying a category preserves transaction type. Excluded categories, pending, split and non-USD records are skipped.')}</p>
    {busy && <p className="notice">{t('Finish synchronization and publish the ledger before reclassifying.')}</p>}
    <div className="reclassification-rules">{rules.data?.map((rule) => <article className="reclassification-rule" key={rule.id}>
      <div><p>{rule.example}</p><span className="reclassification-rule-meta">{t(rule.direction === 'outgoing' ? 'Money sent' : rule.direction === 'incoming' ? 'Money received' : 'Both directions')} <ArrowRight size={12} /> <strong>{categoryLabel(rule.category)}</strong></span></div>
      <div className="reclassification-actions"><button className="button secondary" onClick={() => void scan(rule)} disabled={disabled}><ScanSearch size={14} />{t('Scan existing transactions')}</button><button className="icon-button" aria-label={t('Edit rule')} disabled={disabled} onClick={() => { setEditing(rule); setDraft({ example: rule.example, category: rule.category, direction: rule.direction }); setError(undefined); exampleInput.current?.focus(); }}><Pencil size={14} /></button><button className="icon-button" aria-label={t('Delete rule')} disabled={disabled} onClick={() => void act(rule.id, async () => {
        await api(`/reclassification/rules/${rule.id}`, { method: 'DELETE', body: JSON.stringify({ revision: rule.revision }) });
        if (editing?.id === rule.id) reset(); await refreshData();
      })}><Trash2 size={14} /></button></div>
    </article>)}</div>
    {result && <div className="reclassification-preview" aria-label={t('Reclassification preview')}>
      <div className="reclassification-preview-heading"><h3>{t('Matching transactions')}</h3><span>{t('Scanned {done} / {total}', { done: result.scanned, total: result.total })}</span></div>
      <p className="reclassification-pattern">{result.rule.example}</p>
      <p className="reclassification-help">{t('Target category')}: <strong>{categoryLabel(result.rule.category)}</strong> · {t('{count} records skipped', { count: result.skipped })}</p>
      {scanning && <div role="status"><p>{t('Scanning transactions… No categories have been changed.')}</p><progress max={Math.max(1, result.total)} value={result.scanned} aria-label={t('Scan progress')} /></div>}
      {result.status === 'failed' && <ErrorNotice error={new Error(result.error || t('The scan failed. No categories were changed. Scan again.'))} />}
      {result.status === 'applied' && <p className="notice" role="status"><Check size={15} />{t('Updated {count} transactions. These categories will be preserved during synchronization.', { count: result.applied || 0 })}</p>}
      {result.status === 'ready' && <>
        <p className="reclassification-help">{t('Review matches and uncheck any you do not want to change. Applying replaces the displayed category, including previous manual categories, while preserving notes and countries.')}</p>
        {!result.matches.length ? <p className="settings-empty">{t('No matching transactions. Refine the examples and scan again.')}</p> : <>
          <div className="reclassification-actions"><button className="text-button button" disabled={Boolean(operation)} onClick={() => setSelection({ id: result.id, excluded: new Set() })}>{t('Select all matches')}</button><button className="text-button button" disabled={Boolean(operation)} onClick={() => setSelection({ id: result.id, excluded: new Set(result.matches.map((row) => row.id)) })}>{t('Clear selection')}</button><span>{t('{count} selected', { count: selected.length })}</span></div>
          <ul className="reclassification-matches">{result.matches.slice((currentPage - 1) * 50, currentPage * 50).map((row) => <li key={row.id}><label>
            <input type="checkbox" checked={!excluded.has(row.id)} disabled={Boolean(operation)} aria-label={t('Select {description}', { description: row.description })} onChange={(event) => { const next = new Set(excluded); if (event.target.checked) next.delete(row.id); else next.add(row.id); setSelection({ id: result.id, excluded: next }); }} />
            <span className="reclassification-match"><span className="reclassification-match-heading"><strong>{row.description}</strong><b>{money(row.cashflowCents)}</b></span><small>{row.postedDate} · {row.accountName}</small><span className="reclassification-rule-meta">{categoryLabel(row.category)}{row.classificationSource === 'manual' && <small>({t('Manual entry')})</small>} <ArrowRight size={12} /><strong>{categoryLabel(result.rule.category)}</strong></span><span className="reclassification-reason">{row.reason}</span></span>
          </label></li>)}</ul>
          {pageCount > 1 && <div className="reclassification-actions"><button className="button secondary" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>{t('Previous page')}</button><span>{currentPage} / {pageCount}</span><button className="button secondary" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>{t('Next page')}</button></div>}
          <div className="reclassification-actions"><button className="button primary" disabled={disabled || !selected.length} onClick={() => void apply()}>{operation === 'apply' ? t('Applying…') : t('Apply category to {count} transactions', { count: selected.length })}</button></div>
        </>}
      </>}
    </div>}
  </section>;
}
