import { Select } from '../../Select.js';
import { t, renderMessage, getLocale } from "../../../i18n/index.js";
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Check, RefreshCw, RotateCcw } from 'lucide-react';
import { api, queryClient, refreshData, type SettingsStatus } from '../../api.js';
import { ErrorNotice, Field, Modal } from '../../components.js';
import { monthRange, today, type Account } from '../../../shared/models.js';

export function SyncDialog({ month, onClose }: { month: string; onClose: () => void }) {
  const [period, setPeriod] = useState('month');
  const [selectedMonth, setSelectedMonth] = useState(month);
  const [year, setYear] = useState(month.slice(0, 4));
  const [start, setStart] = useState('2026-01-01'); const [end, setEnd] = useState(today());
  const [type, setType] = useState('sync'); const [force, setForce] = useState(false); const [refresh, setRefresh] = useState(false);
  const [account, setAccount] = useState(''); const [saving, setSaving] = useState(false); const [error, setError] = useState<unknown>();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => api<Account[]>('/accounts') });
  async function submit() {
    setSaving(true); setError(undefined);
    try {
      const reference = today();
      const upper = (date: string) => date > reference ? reference : date;
      const range = period === 'month' ? monthRange(selectedMonth, reference) : period === 'year' ? { start: `${year}-01-01`, end: upper(`${year}-12-31`) } : { start, end };
      await api('/jobs', { method: 'POST', body: JSON.stringify({ type, range, accountIds: account ? [account] : undefined, force: type === 'classify' && force, refresh }) }); await refreshData(); onClose();
    }
    catch (e) { setError(e); } finally { setSaving(false); }
  }
  const available = accounts.data?.filter((a) => a.enabled && (type === 'classify' || (a.source === 'plaid' && !a.disconnectedAt))) || [];
  return <Modal title={t("Update ledger")} onClose={onClose}><div className="form-body"><ErrorNotice error={error} />
    <div className="segmented"><button className={type === 'sync' ? 'active' : ''} onClick={() => { setType('sync'); setAccount(''); }}><RefreshCw size={14} />{t("Sync bank data")}</button><button className={type === 'classify' ? 'active' : ''} onClick={() => { setType('classify'); setAccount(''); }}><RotateCcw size={14} />{t("Reclassify")}</button></div>
    <div className="segmented"><button className={period === 'month' ? 'active' : ''} onClick={() => setPeriod('month')}>{t("Month")}</button><button className={period === 'year' ? 'active' : ''} onClick={() => setPeriod('year')}>{t("Year")}</button><button className={period === 'range' ? 'active' : ''} onClick={() => setPeriod('range')}>{t("Date range")}</button></div>
    {period === 'month' ? <Field label={t("Synchronization month")}><input type="month" max={today().slice(0, 7)} value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} /></Field> : period === 'year' ? <Field label={t("Synchronization year")}><input type="number" min="1900" max={today().slice(0, 4)} value={year} onChange={(e) => setYear(e.target.value)} /></Field> : <div className="form-grid"><Field label={t("Start date")}><input type="date" max={today()} value={start} onChange={(e) => setStart(e.target.value)} /></Field><Field label={t("End date")}><input type="date" min={start} max={today()} value={end} onChange={(e) => setEnd(e.target.value)} /></Field></div>}
    <Field label={t("Accounts to update")}><Select value={account} onValueChange={(nextValue) => setAccount(nextValue)}><option value="">{t("All enabled accounts")}</option>{available.map((a) => <option value={a.id} key={a.id}>{a.name}{a.mask && ` · ${a.mask}`}</option>)}</Select></Field>
    {type === 'sync' && <label className="check-row"><input type="checkbox" checked={refresh} onChange={(e) => setRefresh(e.target.checked)} />{t("Also request a bank refresh (may take longer)")}</label>}
    {type === 'classify' && <label className="check-row"><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />{t("Reanalyze automatic classifications, preserving manual edits")}</label>}
    <p className="muted small"><CalendarDays size={13} />  {t("Defaults to the month you are viewing. Historical availability depends on the bank and existing authorization; imported months are preserved.")}</p>
    {!available.length && <div className="notice"><Link to="/settings">{t("Add or enable accounts in Settings first.")}</Link></div>}
    <div className="form-actions"><button className="button secondary" onClick={onClose}>{t("Cancel")}</button><button className="button primary" onClick={() => void submit()} disabled={saving || !available.length}>{saving ? t("Submitting…") : type === 'sync' ? t("Start synchronization") : t("Start classification")}</button></div>
  </div></Modal>;
}

export function JobStatus({ job, compact = false }: { job?: SettingsStatus['jobs'][number]; compact?: boolean }) {
  const [error, setError] = useState<unknown>(); const [retrying, setRetrying] = useState(false);
  useEffect(() => { if (job?.status && !['queued', 'fetching', 'classifying', 'publishing'].includes(job.status)) void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'status' }); }, [job?.id, job?.status]);
  if (!job) return null;
  const running = ['queued', 'fetching', 'classifying', 'publishing'].includes(job.status);
  const failed = ['partial_failed', 'failed', 'interrupted'].includes(job.status);
  async function retry() { setRetrying(true); try { await api(`/jobs/${job!.id}/retry`, { method: 'POST' }); await refreshData(); } catch (e) { setError(e); } finally { setRetrying(false); } }
  if (compact && job.status === 'succeeded') return <span className="sync-success" role="status"><Check size={15} />{renderMessage(job.message, getLocale())}</span>;
  return <><ErrorNotice error={error} /><div className={`job-status ${failed ? 'job-failed' : ''}`} role="status"><div className="job-line">{running ? <RefreshCw size={15} className="spin" /> : <Check size={15} />}<span>{renderMessage(job.message, getLocale())}</span>{failed && <button onClick={() => void retry()} disabled={retrying}>{t("Retry")} <RotateCcw size={12} /></button>}</div>{running && job.total > 0 && <progress max={job.total} value={job.progress} aria-label={t("Task progress")} />}{job.errors.length > 0 && <details><summary>{t("View details")}</summary><ul>{job.errors.map((message, i) => <li key={i}>{renderMessage(message, getLocale())}</li>)}</ul></details>}</div></>;
}
