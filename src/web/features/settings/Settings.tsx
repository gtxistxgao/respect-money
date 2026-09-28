import { Reclassification } from './Reclassification.js';
import { Select } from '../../Select.js';
import { useConfiguration, ConfigurationFields, ConfigurationNotice } from './Configuration.js';
import { setLanguage, useLanguage } from '../../language.js';
import { t } from "../../../i18n/index.js";
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, Building2, Check, Plus, ShieldCheck, Terminal } from 'lucide-react';
import { api, refreshData, type SettingsStatus, type AccountCoverage } from '../../api.js';
import { type Account } from '../../../shared/models.js';
import { ErrorNotice } from '../../components.js';
import { AccountDialog } from '../accounting/TransactionDialog.js';
import { BankLinkControls } from './BankLink.js';
import { InstitutionTable } from './InstitutionTable.js';
import { JobStatus } from '../sync/SyncDialog.js';

const accountTypeLabels: Record<Account['type'], string> = { checking: 'Checking', savings: 'Savings', credit: 'Credit card', investment: 'Investment account', cash: 'Cash', other: 'Other' };

export function Settings() {
  const locale = useLanguage();
  const config = useConfiguration();
  const { hash, key } = useLocation();
  const [adding, setAdding] = useState(false); const [error, setError] = useState<unknown>();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => api<Account[]>('/accounts') });
  const status = useQuery({ queryKey: ['status'], queryFn: () => api<SettingsStatus>('/settings/status'), refetchInterval: (query) => query.state.data?.jobs.some((job) => ['queued', 'fetching', 'classifying', 'publishing'].includes(job.status)) ? 1000 : 5000 });
  const busy = Boolean(status.data?.jobs.some((job) => ['queued', 'fetching', 'classifying', 'publishing'].includes(job.status)));
  const coverage = useQuery({ queryKey: ['coverage'], queryFn: () => api<AccountCoverage[]>('/accounting/coverage') });
  const configurationLoaded = Boolean(config.data);
  useEffect(() => {
    if (!hash) return;
    const section = document.getElementById(hash.slice(1));
    if (!section?.classList.contains('settings-section')) return;
    section.focus({ preventScroll: true });
    section.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  }, [hash, key, locale, accounts.data?.length, coverage.data?.length, status.data?.connections.length, configurationLoaded]);
  const [toggling, setToggling] = useState<string[]>([]);
  async function toggle(account: Account) {
    setError(undefined); setToggling(ids => [...ids, account.id]);
    try { await api(`/accounts/${account.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !account.enabled }) }); await refreshData(); }
    catch (e) { setError(e); }
    finally { setToggling(ids => ids.filter(id => id !== account.id)); }
  }
  return <main className="settings-main"><Link className="back-link" to="/"><ArrowLeft size={15} />{t("Back to ledger")}</Link><div className="page-heading"><div><div className="breadcrumb">{t('Preferences')}</div><h1>{t("Settings")}</h1><p>{t("Connect accounts to keep your ledger up to date.")}</p></div><span className="local-badge"><ShieldCheck size={16} />{t("Running locally")}</span></div>
    <ErrorNotice error={error || accounts.error || status.error || coverage.error} /><ConfigurationNotice config={config} />
    <section className="settings-section" id="language" tabIndex={-1}><div className="section-heading"><div><h2>{t('Language')}</h2><p>{t('Choose the language for this browser.')}</p></div><Select aria-label={t('Language')} value={locale} onValueChange={(nextValue) => setLanguage(nextValue === 'en' ? 'en' : 'zh')}><option value="en">{t('English')}</option><option value="zh">{t('Chinese (Simplified)')}</option></Select></div></section>
    <section className="settings-section" id="currency" tabIndex={-1}><div className="section-heading"><div><h2>{t('Exchange rate')}</h2><p>{t('Show estimated values in another currency.')}</p></div><button type="button" className={`toggle ${config.values?.displayConversion.enabled ? 'on' : ''}`} role="switch" aria-label={t('Enable currency conversion')} aria-checked={config.values?.displayConversion.enabled ?? true} disabled={!config.values || config.saving} onClick={() => config.update({ displayConversion: { ...config.values!.displayConversion, enabled: !config.values!.displayConversion.enabled } })}><span>{config.values?.displayConversion.enabled && <Check size={12} />}</span></button></div><ConfigurationFields config={config} section="currency" busy={busy} /></section>
    <section className="settings-section" id="bank-connections" tabIndex={-1}><div className="section-heading"><div className="section-icon"><Building2 size={21} /></div><div><h2>{t("Bank connections")}</h2><p>{t('Connect your institution once to read balances, bank transactions and investments.')}</p></div><span className="currency-pill">{status.data?.plaidEnv === 'production' ? t('Production') : t('Sandbox')}</span></div>
      {!status.data?.plaidConfigured && <div className="notice">{t("Add your Plaid credentials below to connect a bank.")}</div>}
      <ConfigurationFields config={config} section="plaid" busy={busy} />
      <BankLinkControls />
    </section>
    <section className="settings-section" id="accounts" tabIndex={-1}><div className="section-heading"><div><h2>{t("My accounts")}</h2><p>{t("Choose which accounts to include in your monthly ledger.")}</p></div><button className="button secondary" onClick={() => setAdding(true)}><Plus size={16} />{t("Manual account")}</button></div>
      {accounts.data?.length ? <InstitutionTable rows={accounts.data} label={t('My accounts')} className="settings-accounts-table" columns={[
        { key: 'institution', label: 'Institution name', value: account => account.institution, render: account => account.institution },
        { key: 'name', label: 'Account name', value: account => account.name, render: account => account.name },
        { key: 'mask', label: 'Last four digits', value: account => account.mask, render: account => account.mask || '—' },
        { key: 'type', label: 'Account type', value: account => t(accountTypeLabels[account.type]), render: account => t(accountTypeLabels[account.type]) },
        { key: 'source', label: 'Data source', value: account => account.disconnectedAt ? t('Disconnected') : account.source === 'manual' ? t('Manual entry') : 'Plaid', render: account => account.disconnectedAt ? t('Disconnected') : account.source === 'manual' ? t('Manual entry') : 'Plaid' },
        { key: 'enabled', label: 'Include in ledger', value: account => Number(account.enabled), render: account => <button className={`toggle ${account.enabled ? 'on' : ''}`} role="switch" aria-checked={account.enabled} aria-label={t('Enable {p0}', { p0: account.name })} disabled={toggling.includes(account.id)} onClick={() => void toggle(account)}><span>{account.enabled && <Check size={12} />}</span></button> },
      ]} /> : <div className="settings-empty">{t("Add an account to start recording income and spending.")}</div>}
    </section>
    <section className="settings-section" id="classification" tabIndex={-1}><div className="section-heading"><div className="section-icon"><Terminal size={21} /></div><div><h2>{t("Automatic classification")}</h2><p>{t("Analyze transactions with your local Codex or Claude Code CLI.")}</p></div></div><div className="settings-row"><span>{status.data?.classificationProvider === 'claude' ? 'Claude Code' : 'Codex CLI'}</span><strong>{status.data?.cliVersion || t("Not detected. Install it and sign in.")}</strong></div><ConfigurationFields config={config} section="classification" busy={busy} /><div className="settings-row"><span>{t("Default history start")}</span><strong>{t("January 2026")}</strong></div><p className="muted small">{t("Choose an earlier range during synchronization. Manual categories, countries and splits are always preserved.")}</p></section>
    <Reclassification busy={busy} />
    <section className="settings-section" id="advanced" tabIndex={-1}><div className="section-heading"><div><h2>{t("Advanced settings")}</h2><p>{t("Configure the local classification process and server.")}</p></div></div><ConfigurationFields config={config} section="advanced" busy={busy} /></section>
    <section className="settings-section" id="history" tabIndex={-1}><div className="section-heading"><div><h2>{t("Historical data coverage")}</h2><p>{t("Banks may provide limited history. Months without records do not necessarily have no cash flow.")}</p></div></div>{!coverage.isPending && !coverage.data?.length && <p className="settings-empty">{t("Connect a bank to view historical data coverage.")}</p>}{coverage.data?.map((item) => <div className="coverage-item" key={item.accountId}><strong>{item.accountName}{item.accountMask && t(" · ending in {p0}", { p0: item.accountMask })}</strong><dl><dt>{t("Requested and enabled")}</dt><dd>{item.ranges.length ? item.ranges.map((r) => t("{p0} to {p1}", { p0: r.start, p1: r.end })).join('; ') : t("Not synchronized")}</dd><dt>{t("Received transactions")}</dt><dd>{item.firstRecord ? t("{p0} to {p1} · {p2} transactions", { p0: item.firstRecord, p1: item.lastRecord, p2: item.recordCount }) : t("No records received")}</dd><dt>{t("Bank processing status")}</dt><dd>{item.historyStatus === 'HISTORICAL_UPDATE_COMPLETE' ? t("Historical request completed") : item.historyStatus === 'REQUESTED_RANGES_FETCHED' ? t("Date range request completed") : item.historyStatus === 'NOT_IMPORTED' ? t("Not synchronized") : t("Historical data is still being prepared")}</dd></dl><p>{t("These dates do not guarantee earlier months are complete. Compare coverage with your bank statements.")}</p></div>)}</section>
    <JobStatus job={status.data?.jobs[0]} />
    {adding && <AccountDialog onClose={() => setAdding(false)} />}
  </main>;
}
