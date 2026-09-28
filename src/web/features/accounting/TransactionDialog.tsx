import { useCategories } from '../../categories.js';
import { Select } from '../../Select.js';
import { t } from "../../../i18n/index.js";
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { financialKind, countryOptions, kindLabels, today, type Account, type SourceTransaction, type TransactionOverride, type Split } from '../../../shared/models.js';
import { api, money, refreshData } from '../../api.js';
import { ErrorNotice, Field, Loading, Modal } from '../../components.js';

type Detail = { transaction: Omit<SourceTransaction, 'raw'>; editableKind?: SourceTransaction['kind']; override?: TransactionOverride; version: string; reason?: string; classificationSource?: string };
export function CategorySelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { options: categoryOptions } = useCategories();
  return <Select aria-label={t("Categories")} value={value} onValueChange={(nextValue) => onChange(nextValue)}>{categoryOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</Select>;
}
export function CountrySelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [custom, setCustom] = useState(!countryOptions.some(([code]) => code === value));
  return <><Select aria-label={t("Country")} value={custom ? '__custom' : value} onValueChange={(nextValue) => { const custom = nextValue === '__custom'; setCustom(custom); onChange(custom ? '' : nextValue); }}>
    {countryOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
    <option value="__custom">{t("Other country (enter code)")}</option>
  </Select>{custom && <input aria-label={t("Country code")} value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} maxLength={2} pattern="[A-Z]{2}" required placeholder={t("e.g. NZ")} />}</>;
}
export function AccountDialog({ onClose }: { onClose: () => void }) {
  const [error, setError] = useState<unknown>(); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(undefined);
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try { await api('/accounts/manual', { method: 'POST', body: JSON.stringify(data) }); await refreshData(); onClose(); }
    catch (e) { setError(e); } finally { setSaving(false); }
  }
  return <Modal title={t("Add manual account")} onClose={onClose}><form onSubmit={submit} className="form-body">
    <p className="muted">{t("Create an account for cash or a bank card you cannot connect yet.")}</p><ErrorNotice error={error} />
    <Field label={t("Account name")}><input name="name" placeholder={t("e.g. My credit card")} required maxLength={100} autoFocus /></Field>
    <div className="form-grid"><Field label={t("Institution name")}><input name="institution" placeholder={t("e.g. Chase, cash")} required maxLength={100} /></Field><Field label={t("Last four digits (optional)")}><input name="mask" maxLength={4} inputMode="numeric" placeholder="1827" /></Field></div>
    <Field label={t("Account type")}><Select name="type" defaultValue="credit"><option value="credit">{t("Credit card")}</option><option value="checking">{t("Checking")}</option><option value="savings">{t("Savings")}</option><option value="investment">{t("Investment account")}</option><option value="cash">{t("Cash")}</option><option value="other">{t("Other")}</option></Select></Field>
    <div className="form-actions"><button type="button" className="button secondary" onClick={onClose}>{t("Cancel")}</button><button className="button primary" disabled={saving}>{saving ? t("Saving…") : t("Add account")}</button></div>
  </form></Modal>;
}

export function TransactionDialog({ id, mode = 'edit', accounts, month, onClose }: { id?: string; mode?: 'edit' | 'split'; accounts: Account[]; month: string; onClose: () => void }) {
  const detail = useQuery({ queryKey: ['transaction', id], queryFn: () => api<Detail>(`/transactions/${id}`), enabled: Boolean(id) });
  return <Modal title={mode === 'split' ? t("Split transaction") : id ? t("Edit transaction") : t("Add transaction")} onClose={onClose} wide={mode === 'split'}>
    {id && detail.isPending ? <Loading /> : id && detail.error ? <ErrorNotice error={detail.error} /> : mode === 'split' && detail.data ?
      <SplitForm detail={detail.data} onClose={onClose} /> : <TransactionForm detail={detail.data} accounts={accounts} month={month} onClose={onClose} />}
  </Modal>;
}

function TransactionForm({ detail, accounts, month, onClose }: { detail?: Detail; accounts: Account[]; month: string; onClose: () => void }) {
  const manualAccounts = accounts.filter((a) => a.source === 'manual');
  const bank = Boolean(detail && detail.transaction.source !== 'manual');
  const tx = detail?.transaction; const override = detail?.override;
  const [category, setCategory] = useState<string>(tx?.category || override?.category || 'uncategorized');
  const [country, setCountry] = useState(override?.country || tx?.country || 'US');
  const [kind, setKind] = useState<string>(financialKind(override?.kind || tx?.kind || 'expense', tx?.cashflowCents ?? -1));
  const { definitions } = useCategories();
  const [excluded, setExcluded] = useState(Boolean(override?.excluded));
  const [error, setError] = useState<unknown>(); const [saving, setSaving] = useState(false);
  const date = tx?.postedDate || (today().startsWith(month) ? today() : `${month}-01`);
  async function unmatch() {
    if (!detail) return;
    try { await api(`/transactions/${detail.transaction.id}/match`, { method: 'PUT', body: JSON.stringify({ version: detail.version, duplicateOf: null }) }); await refreshData(); onClose(); } catch (e) { setError(e); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(undefined);
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (bank && detail) await api(`/transactions/${detail.transaction.id}/overrides`, { method: 'PUT', body: JSON.stringify({ kind, category, country, notes: data.notes, excluded, version: detail.version }) });
      else {
        await api(detail ? `/transactions/manual/${detail.transaction.id}` : '/transactions/manual', { method: detail ? 'PATCH' : 'POST', body: JSON.stringify({ ...data, kind, category, country, version: detail?.version }) });
        if (detail && excluded !== Boolean(override?.excluded)) {
          const fresh = await api<Detail>(`/transactions/${detail.transaction.id}`);
          await api(`/transactions/${detail.transaction.id}/overrides`, { method: 'PUT', body: JSON.stringify({ excluded, version: fresh.version }) });
        }
      }
      await refreshData(); onClose();
    } catch (e) { setError(e); } finally { setSaving(false); }
  }
  if (!bank && !manualAccounts.length) return <div className="form-body"><p>{t("Add a manual account before entering a transaction.")}</p><button className="button secondary" onClick={onClose}>{t("Back")}</button></div>;
  return <form onSubmit={submit} className="form-body"><ErrorNotice error={error} />
    {override?.duplicateOf && <div className="notice">{t("This manual entry is linked to a bank transaction and is not counted twice.")}<button type="button" className="inline-button" onClick={() => void unmatch()}>{t("Unlink")}</button></div>}
    {detail?.reason && <div className="classification-note"><span>{['codex', 'claude'].includes(detail.classificationSource ?? '') ? t("AI classification rationale") : t("Items to review")}</span><p>{detail.reason}</p></div>}
    {bank ? <div className="transaction-preview"><strong>{tx?.description}</strong><span>{date} · {money(tx?.cashflowCents || 0)}</span><p>{t("Original bank dates and amounts are preserved. Your edits will remain after synchronization.")}</p></div> : <>
      <Field label={t("Account")}><Select name="accountId" defaultValue={tx?.accountId || manualAccounts[0]?.id}>{manualAccounts.map((a) => <option value={a.id} key={a.id}>{a.name}{a.mask && ` · ${a.mask}`}</option>)}</Select></Field>
      <Field label={t("Description")}><input name="description" defaultValue={tx?.description} placeholder={t("e.g. Groceries, salary payment")} required maxLength={500} autoFocus /></Field>
      <div className="form-grid"><Field label={t("Posting date")}><input type="date" name="postedDate" required defaultValue={date} /></Field><Field label={t("Amount (USD)")}><input name="amount" required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" defaultValue={tx ? (Math.abs(tx.cashflowCents) / 100).toFixed(2) : ''} placeholder="0.00" /></Field></div>
    </>}
    <Field label={t("Transaction type")}><Select value={kind} onValueChange={(nextValue) => setKind(nextValue)}>{Object.entries(kindLabels).filter(([value]) => ['income', 'expense', 'refund', 'review'].includes(value)).map(([value, label]) => <option value={value} key={value}>{t(label)}</option>)}</Select></Field>
    <div className="form-grid"><Field label={t("Categories")}><CategorySelect value={category} onChange={setCategory} /></Field><Field label={t("Country of transaction")}><CountrySelect value={country} onChange={setCountry} /></Field></div>
    {definitions.find(row => row.id === category)?.includeInCashflow === false && <p className="muted">{t('Excluded from income and spending')}</p>}
    <Field label={t("Notes (optional)")}><textarea name="notes" rows={2} defaultValue={override?.notes ?? tx?.notes} maxLength={2000} placeholder={t("Add information about this transaction")} /></Field>
    {detail && <label className="check-row"><input type="checkbox" checked={excluded} onChange={(e) => setExcluded(e.target.checked)} />{t("Exclude from income and spending")}</label>}
    <div className="form-actions"><button type="button" className="button secondary" onClick={onClose}>{t("Cancel")}</button><button className="button primary" disabled={saving}>{saving ? t("Saving…") : t("Save transaction")}</button></div>
  </form>;
}

function SplitForm({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  const tx = detail.transaction;
  const defaultKind = tx.cashflowCents < 0 ? 'expense' : (detail.editableKind || tx.kind) === 'refund' ? 'refund' : 'income';
  const initial: Split[] = detail.override?.splits?.length ? detail.override.splits : [{ cashflowCents: tx.cashflowCents, category: detail.override?.category || tx.category, country: detail.override?.country || tx.country, kind: defaultKind, description: '' }];
  const [parts, setParts] = useState(initial.map((part) => ({ ...part, amount: (Math.abs(part.cashflowCents) / 100).toFixed(2) })));
  const [error, setError] = useState<unknown>(); const [saving, setSaving] = useState(false);
  const amount = (value: string) => /^\d+(\.\d{1,2})?$/.test(value) ? Math.round(Number(value) * 100) : 0;
  const remaining = Math.abs(tx.cashflowCents) - parts.reduce((sum, part) => sum + amount(part.amount), 0);
  async function save(reset = false) {
    setSaving(true); setError(undefined);
    try {
      await api(`/transactions/${tx.id}/splits`, { method: 'PUT', body: JSON.stringify({ version: detail.version, splits: reset ? [] : parts.map(({ amount: input, ...part }) => ({ ...part, cashflowCents: amount(input) * Math.sign(tx.cashflowCents) })) }) });
      await refreshData(); onClose();
    } catch (e) { setError(e); } finally { setSaving(false); }
  }
  return <div className="form-body"><div className="transaction-preview"><strong>{tx.description}</strong><span>{t("Original transaction amount")} {money(Math.abs(tx.cashflowCents))}</span></div><ErrorNotice error={error} />
    {parts.map((part, index) => <div className="split-part" key={part.id || index}>
      <div className="split-heading"><strong>{t("Split item")} {index + 1}</strong><button className="icon-button" aria-label={t("Delete split {p0}", { p0: index + 1 })} disabled={parts.length === 1} onClick={() => setParts(parts.filter((_, i) => i !== index))}><Trash2 size={16} /></button></div>
      <div className="form-grid"><Field label={t("Description")}><input value={part.description} onChange={(e) => setParts(parts.map((p, i) => i === index ? { ...p, description: e.target.value } : p))} placeholder={tx.description} /></Field><Field label={t("Amount (USD)")}><input value={part.amount} inputMode="decimal" onChange={(e) => setParts(parts.map((p, i) => i === index ? { ...p, amount: e.target.value } : p))} /></Field></div>
      <div className="form-grid"><Field label={t("Categories")}><CategorySelect value={part.category} onChange={(value) => setParts(parts.map((p, i) => i === index ? { ...p, category: value as Split['category'] } : p))} /></Field><Field label={t("Country")}><CountrySelect value={part.country} onChange={(value) => setParts(parts.map((p, i) => i === index ? { ...p, country: value } : p))} /></Field></div>
    </div>)}
    <div className="split-footer"><button className="button secondary" onClick={() => setParts([...parts, { amount: (Math.max(0, remaining) / 100).toFixed(2), cashflowCents: 0, category: 'uncategorized', country: 'US', description: '', kind: defaultKind }])}><Plus size={16} />{t("Add split")}</button><span className={remaining ? 'danger-text' : 'income-text'}>{t("Unallocated")} {money(remaining)}</span></div>
    <div className="form-actions">{detail.override?.splits?.length ? <button className="button text-button" disabled={saving} onClick={() => void save(true)}>{t("Remove split")}</button> : null}<button className="button primary" disabled={saving || remaining !== 0 || parts.some((p) => !amount(p.amount))} onClick={() => void save()}>{saving ? t("Saving…") : t("Save split")}</button></div>
  </div>;
}
