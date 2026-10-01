import { useCategories } from '../../categories.js';
import { Select } from '../../Select.js';
import { useLanguage } from '../../language.js';
import { t, formatMonth, transactionCount } from "../../../i18n/index.js";
import { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useSearchParams, Link } from 'react-router-dom';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, Filter, Plus, RefreshCw, Pencil, Split, WalletCards, ArrowDownUp, Search, X } from 'lucide-react';
import { type Account, type LedgerRow, type MonthSummary, countryOptions, countryLabel, isAwaitingReview, today } from '../../../shared/models.js';
import { api, money, refreshData, type SettingsStatus } from '../../api.js';
import { ErrorNotice, Loading } from '../../components.js';
import { CategoryIcon } from '../../CategoryIcon.js';
import { AccountDialog, TransactionDialog } from './TransactionDialog.js';
import { JobStatus, SyncDialog } from '../sync/SyncDialog.js';
import { DuplicateReview, type DuplicateGroup } from './DuplicateReview.js';
import { CategoryBreakdown } from '../overview/CategoryBreakdown.js';
import { InlineCategory } from './InlineCategory.js';
import { InlineKind } from './InlineKind.js';
import { FilterMenu } from './FilterMenu.js';
import { resetTableFilters } from './filters.js';

const emptyRows: LedgerRow[] = [];
type Results = { rows: LedgerRow[]; total: number; page: number; pageSize: number; subtotalCents: number };
export function Accounting() {
  const { options: categoryOptions } = useCategories();
  const locale = useLanguage();
  const [params, setParams] = useSearchParams();
  const month = params.get('month') || today().slice(0, 7);
  const mode = params.get('mode') || 'expense';
  const [dialog, setDialog] = useState<{ type: 'account' | 'transaction' | 'split' | 'sync'; id?: string }>();
  const [actionError, setActionError] = useState<unknown>();
  async function publishRules() { try { await api('/accounting/publish-rules', { method: 'POST' }); await refreshData(); } catch (error) { setActionError(error); } }
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => api<Account[]>('/accounts') });
  const status = useQuery({ queryKey: ['status'], queryFn: () => api<SettingsStatus>('/settings/status'), refetchInterval: (query) => query.state.data?.jobs.some((job) => ['queued', 'fetching', 'classifying', 'publishing'].includes(job.status)) ? 1000 : 5000 });
  const duplicates = useQuery({ queryKey: ['duplicates', month], queryFn: () => api<DuplicateGroup[]>(`/accounting/duplicates?month=${month}`) });
  const accountFilter = params.get('accounts') || '';
  const transactionAccountOptions = (accounts.data || []).filter(account => account.enabled && (!accountFilter || accountFilter.split(',').includes(account.id)))
    .sort((a, b) => a.name.localeCompare(b.name) || a.mask.localeCompare(b.mask) || a.institution.localeCompare(b.institution) || a.id.localeCompare(b.id))
    .map(account => [account.id, `${account.name}${account.mask ? ` · ${account.mask}` : ''} · ${account.institution}`] as const);
  const summary = useQuery({ queryKey: ['summary', month, accountFilter], queryFn: () => api<MonthSummary>(`/accounting/summary?${new URLSearchParams({ month, ...(accountFilter ? { accounts: accountFilter } : {}) })}`) });
  const availableSummary = summary.data && !(summary.data.incompleteAccounts.length && summary.data.transactionCount === 0) ? summary.data : undefined;
  const query = new URLSearchParams(params); query.set('month', month); query.set('mode', mode);
  const transactions = useQuery({ queryKey: ['transactions', query.toString()], queryFn: () => api<Results>(`/accounting/transactions?${query}`), placeholderData: keepPreviousData });
  function change(key: string, value: string) {
    setParams((previous) => { const next = new URLSearchParams(previous); if (value) next.set(key, value); else next.delete(key); if (key !== 'page') next.delete('page'); if (key === 'accounts') next.delete('transactionAccounts'); return next; });
  }
  function toggleSummary(target: 'expense' | 'income' | 'refund') {
    setParams((previous) => {
      if ((previous.get('mode') || 'expense') === target) return resetTableFilters(previous);
      const next = new URLSearchParams(previous);
      next.set('mode', target);
      next.delete('page');
      return next;
    });
  }
  function sort(column: string) {
    setParams((previous) => { const next = new URLSearchParams(previous); next.set('sort', column); next.delete('page'); next.set('direction', previous.get('sort') === column && previous.get('direction') === 'asc' ? 'desc' : 'asc'); return next; });
  }
  const columns = useMemo<ColumnDef<LedgerRow>[]>(() => {
    void locale; // Labels and currency formatting must refresh when the language changes.
    return [
    { id: 'date', accessorKey: 'postedDate', cell: ({ row }) => <span className="date-cell">{row.original.postedDate.slice(5).replace('-', ' / ')}</span> },
    { id: 'description', accessorKey: 'description', cell: ({ row }) => <div className="description-cell"><span className={`merchant-icon merchant-${row.original.category}`}><CategoryIcon category={row.original.category} size={20} /></span><div className="description-content"><button className="description-button" title={row.original.description} onClick={() => setDialog({ type: 'transaction', id: row.original.parentId })}>{row.original.description}</button><small>{row.original.splitId && t(" · Split")}{isAwaitingReview(row.original) && t(" · Needs review")}{row.original.excluded && t(" · Excluded")}</small></div></div> },
    { id: 'account', accessorKey: 'accountName', cell: ({ row }) => <span className="ledger-account-cell" title={`${row.original.accountName}${row.original.accountMask ? ` · ${row.original.accountMask}` : ''}`}><span>{row.original.accountName}</span>{row.original.accountMask && <span className="account-mask"> · {row.original.accountMask}</span>}</span> },
    { id: 'amount', accessorKey: 'cashflowCents', cell: ({ row }) => {
      const { cashflowCents, currency, kind, needsReview } = row.original;
      const showDirection = (mode === 'review' && isAwaitingReview(row.original)) || kind === 'review' || needsReview || kind === 'transfer' || kind === 'investment' || Boolean(row.original.categoryExcluded);
      const incoming = showDirection ? cashflowCents > 0 : kind === 'income' || kind === 'refund';
      const sign = showDirection ? cashflowCents < 0 ? '−' : cashflowCents > 0 ? '+' : '' : kind === 'refund' ? (mode === 'expense' ? '−' : '+') : kind === 'income' ? '+' : '';
      return <span className={`amount-cell ${incoming ? 'income-text' : ''}`}>{sign}{money(Math.abs(cashflowCents), currency)}</span>;
    } },
    { id: 'category', accessorKey: 'category', cell: ({ row }) => <InlineCategory row={row.original} /> },
    { id: 'kind', accessorKey: 'kind', cell: ({ row }) => <InlineKind row={row.original} /> },
    { id: 'country', accessorKey: 'country', cell: ({ row }) => <span className="location-cell">{countryLabel(row.original.country)}{row.original.countrySource === 'default' && <small>{t("(default)")}</small>}</span> },
    { id: 'actions', cell: ({ row }) => <div className="row-actions"><button className="icon-button" aria-label={t("Edit {p0}", { p0: row.original.description })} onClick={() => setDialog({ type: 'transaction', id: row.original.parentId })}><Pencil size={15} /></button><button className="icon-button" aria-label={t("Split {p0}", { p0: row.original.description })} onClick={() => setDialog({ type: 'split', id: row.original.parentId })}><Split size={15} /></button></div> },
  ]; }, [locale, mode]);
  // React Compiler is not enabled; TanStack Table owns its row model memoization.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: transactions.data?.rows || emptyRows, columns, getRowId: (row) => row.id, getCoreRowModel: getCoreRowModel() });
  const filtered = ['q', 'categories', 'countries', 'transactionAccounts', 'from', 'to', 'min', 'max'].some((key) => params.has(key));
  return <>
    <main className="accounting-main">
      <div className="page-heading"><div><div className="breadcrumb">{t('Accounting')} <span>/</span>  {t("Monthly cash flow")}</div><h1>{formatMonth(month)}</h1><p>{t("Understand every dollar coming in and going out.")}</p></div><div className="heading-actions">{status.data?.jobs[0]?.status === 'succeeded' && <JobStatus job={status.data.jobs[0]} compact />}<button className="button secondary" onClick={() => setDialog({ type: 'sync' })}><RefreshCw size={16} />{t("Sync bank data")}</button><button className="button primary" onClick={() => setDialog({ type: accounts.data?.some((a) => a.source === 'manual') ? 'transaction' : 'account' })}><Plus size={17} />{t("Add transaction")}</button></div></div>
      <ErrorNotice error={actionError || accounts.error || summary.error || transactions.error} />
      {status.data?.jobs[0]?.status !== 'succeeded' && <JobStatus job={status.data?.jobs[0]} />}
      {Boolean(duplicates.data?.length) && mode !== 'review' && <div className="notice">{t("Possible duplicate entries: {count}.", { count: duplicates.data?.length })}<button className="inline-button" onClick={() => change('mode', 'review')}>{t("Review duplicates")}</button></div>}
      {mode === 'review' && <DuplicateReview groups={duplicates.data || []} />}
      {summary.data?.stale && <div className="notice"><span>{t("Classification is out of date. Showing the last successfully published ledger.")}<button className="inline-button" onClick={() => void publishRules()}>{t("Update using bank rules; classify later")}</button></span></div>}
      {Boolean(summary.data?.incompleteAccounts.length) && <div className="notice">{t("Incomplete synchronization: {accounts}. Only received records are included.", { accounts: summary.data?.incompleteAccounts.join(t("list.separator")) })}</div>}
      <div className={`monthly-summary-row ${summary.data ? 'with-categories' : ''}`}>
      <section className="overview-section" aria-label={t("This month")}>
      <div className="overview-toolbar"><span className="subtle-label">{t("This month")} <span className="currency-pill">USD</span></span><Select aria-label={t("Filter accounts")} value={accountFilter} onValueChange={(nextValue) => change('accounts', nextValue)}><option value="">{t("All enabled accounts")}</option>{accounts.data?.filter((a) => a.enabled).map((a) => <option key={a.id} value={a.id}>{a.name}{a.mask && ` · ${a.mask}`}</option>)}</Select></div>
      <div className="summary-grid"><button className={`summary-panel ${mode === 'expense' ? 'selected' : ''}`} aria-pressed={mode === 'expense'} onClick={() => toggleSummary('expense')}><div className="summary-label"><span>{t("Total spending")}</span><span className="summary-symbol expense-symbol"><ArrowUpRight size={21} /></span></div><strong>{availableSummary ? money(availableSummary.expenseCents) : '—'}</strong><div className="summary-caption">{t("Net of received refunds")}<span>{mode === 'expense' ? t("Viewing") : t("View details")} <ChevronRight size={14} /></span></div></button>
      <button className={`summary-panel income-panel ${mode === 'income' ? 'selected' : ''}`} aria-pressed={mode === 'income'} onClick={() => toggleSummary('income')}><div className="summary-label"><span>{t("Total income")}</span><span className="summary-symbol income-symbol"><ArrowDownLeft size={21} /></span></div><strong>{availableSummary ? money(availableSummary.incomeCents) : '—'}</strong><div className="summary-caption">{t("Included income this month")}<span>{mode === 'income' ? t("Viewing") : t("View details")} <ChevronRight size={14} /></span></div></button>
      <button className={`summary-panel refund-panel ${mode === 'refund' ? 'selected' : ''}`} aria-pressed={mode === 'refund'} onClick={() => toggleSummary('refund')}><div className="summary-label"><span>{t("Total refunds")}</span><span className="summary-symbol income-symbol"><ArrowDownLeft size={21} /></span></div><strong>{availableSummary ? money(availableSummary.refundCents) : '—'}</strong><div className="summary-caption">{t("Refunds received this month offset spending")}<span>{mode === 'refund' ? t("Viewing") : t("View details")} <ChevronRight size={14} /></span></div></button>
      <div className={`summary-panel balance-panel ${availableSummary && availableSummary.netCents > 0 ? 'positive' : availableSummary && availableSummary.netCents < 0 ? 'negative' : 'neutral'}`}><span className="balance-symbol" aria-hidden="true"><WalletCards size={32} strokeWidth={1.6} /></span><div className="balance-copy"><span className="balance-title">{t("Monthly balance")}</span><strong>{availableSummary ? money(availableSummary.netCents) : '—'}</strong></div></div></div>
      </section>
      {summary.data && <CategoryBreakdown data={summary.data} accounts={accountFilter} />}
      </div>
      <section className="transactions-section"><div className="table-toolbar"><div className="table-tabs"><button className={mode === 'all' ? 'active' : ''} onClick={() => change('mode', 'all')}>{t("All transactions")}</button><button className={mode === 'expense' ? 'active' : ''} onClick={() => change('mode', 'expense')}>{t("Spending details")}</button><button className={mode === 'income' ? 'active' : ''} onClick={() => change('mode', 'income')}>{t("Income details")}</button><button className={mode === 'refund' ? 'active' : ''} onClick={() => change('mode', 'refund')}>{t("Refund details")}</button><button className={mode === 'review' ? 'active' : ''} onClick={() => change('mode', 'review')}>{t("Needs review")}{Boolean(summary.data?.reviewCount) && <span className="count-badge">{summary.data?.reviewCount}</span>}</button></div><span className="table-count">{transactionCount(transactions.data?.total || 0)}</span></div>
      {filtered && <div className="filter-status"><Filter size={14} /><span>{t("Filters applied")}</span><button onClick={() => setParams((previous) => { const next = new URLSearchParams(previous); ['q', 'categories', 'countries', 'transactionAccounts', 'from', 'to', 'min', 'max', 'page'].forEach((key) => next.delete(key)); return next; })}>{t("Clear filters")} <X size={13} /></button></div>}
      <div className="table-scroll"><table className="transaction-table"><thead><tr>
        <th><div className="column-header"><button onClick={() => sort('date')}>{t("Date")} <ArrowDownUp size={12} /></button><FilterMenu label={t("Filter dates")}><label>{t("Start date")}<input aria-label={t("Filter start date")} type="date" value={params.get('from') || ''} onChange={(e) => change('from', e.target.value)} /></label><label>{t("End date")}<input aria-label={t("Filter end date")} type="date" value={params.get('to') || ''} onChange={(e) => change('to', e.target.value)} /></label></FilterMenu></div></th>
        <th className="ledger-col-description"><div className="column-header"><button onClick={() => sort('description')}>{t("Description")} <ArrowDownUp size={12} /></button><FilterMenu label={t("Filter descriptions")}><label>{t("Description or notes")}<input aria-label={t("Filter description keywords")} placeholder={t("Search keywords")} value={params.get('q') || ''} onChange={(e) => change('q', e.target.value)} /></label></FilterMenu></div></th>
        <th className="ledger-col-account" aria-sort={params.get('sort') === 'account' ? params.get('direction') === 'asc' ? 'ascending' : 'descending' : 'none'}><div className="column-header"><button onClick={() => sort('account')}>{t("Account")} <ArrowDownUp size={12} /></button><FilterMenu label={t("Filter transaction accounts")}><strong>{t("Account")}</strong><FilterChecks translateLabels={false} options={transactionAccountOptions} selected={params.get('transactionAccounts') || ''} onChange={value => change('transactionAccounts', value)} /></FilterMenu></div></th>
        <th className="align-right ledger-col-amount"><div className="column-header"><button onClick={() => sort('amount')}>{t("Amount")} <ArrowDownUp size={12} /></button><FilterMenu label={t("Filter amounts")}><label>{t("Minimum amount")}<input aria-label={t("Filter minimum amount")} type="number" min="0" step="0.01" value={params.get('min') || ''} onChange={(e) => change('min', e.target.value)} /></label><label>{t("Maximum amount")}<input aria-label={t("Filter maximum amount")} type="number" min="0" step="0.01" value={params.get('max') || ''} onChange={(e) => change('max', e.target.value)} /></label></FilterMenu></div></th>
        <th className="ledger-col-category"><div className="column-header"><button onClick={() => sort('category')}>{t("Category")} <ArrowDownUp size={12} /></button><FilterMenu label={t("Filter categories")}><strong>{t("Categories")}</strong><FilterChecks translateLabels={false} options={categoryOptions} selected={params.get('categories') || ''} onChange={(value) => change('categories', value)} /></FilterMenu></div></th>
        <th className="ledger-col-kind"><div className="column-header"><span>{t("Cash flow type")}</span></div></th>
        <th className="ledger-col-country"><div className="column-header"><span>{t("Spending location")}</span><FilterMenu label={t("Filter spending locations")}><strong>{t("Country")}</strong><FilterChecks options={countryOptions} selected={params.get('countries') || ''} onChange={(value) => change('countries', value)} /></FilterMenu></div></th><th><span className="sr-only">{t("Actions")}</span></th>
      </tr></thead><tbody>{table.getRowModel().rows.map((row) => <tr key={row.id}>{row.getVisibleCells().map((cell) => <td key={cell.id} className={`ledger-col-${cell.column.id}`}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody></table></div>
      {transactions.isPending ? <Loading /> : !transactions.data?.rows.length && <div className="empty-state"><div className="empty-icon">{filtered ? <Search size={25} /> : <WalletCards size={25} />}</div><h2>{filtered ? t("No records match these filters") : mode === 'income' ? t("No income records this month") : mode === 'review' ? t("No records awaiting review this month") : t("No records this month")}</h2><p>{filtered ? t("Try other keywords, amounts or categories.") : t("Connect a bank or add your first transaction manually.")}</p>{!filtered && <button className="button secondary" onClick={() => setDialog({ type: accounts.data?.some((a) => a.source === 'manual') ? 'transaction' : 'account' })}><Plus size={16} />{t("Add record")}</button>}</div>}
      <div className="table-footer"><span>{mode === 'review' ? t("Amount awaiting review") : mode === 'all' ? t("Net transaction flow") : t("Filtered total")} <strong>{money(transactions.data?.subtotalCents || 0)}</strong></span><div><button className="icon-button" aria-label={t("Previous page")} disabled={(transactions.data?.page || 1) <= 1} onClick={() => change('page', String((transactions.data?.page || 1) - 1))}><ChevronLeft size={17} /></button><span>{transactions.data?.page || 1} / {Math.max(1, Math.ceil((transactions.data?.total || 0) / 30))}</span><button className="icon-button" aria-label={t("Next page")} disabled={(transactions.data?.page || 1) * 30 >= (transactions.data?.total || 0)} onClick={() => change('page', String((transactions.data?.page || 1) + 1))}><ChevronRight size={17} /></button></div></div>
      </section><footer className="page-footer">{t("Only received, posted USD transactions are included. Categories can be edited; original transactions are preserved.")}{accounts.data?.some((a) => a.source === 'plaid') && <> <Link to="/settings">{t("Check bank history coverage")}</Link></>}</footer>
    </main>
    {dialog?.type === 'account' && <AccountDialog onClose={() => setDialog(undefined)} />}
    {(dialog?.type === 'transaction' || dialog?.type === 'split') && <TransactionDialog id={dialog.id} mode={dialog.type === 'split' ? 'split' : 'edit'} accounts={accounts.data || []} month={month} onClose={() => setDialog(undefined)} />}
    {dialog?.type === 'sync' && <SyncDialog month={month} onClose={() => setDialog(undefined)} />}
  </>;
}

function FilterChecks({ options, selected, onChange, translateLabels = true }: { translateLabels?: boolean; options: readonly (readonly [string, string])[]; selected: string; onChange: (value: string) => void }) {
  const values = selected ? selected.split(',') : [];
  return <div className="filter-checks">{options.map(([id, label]) => <label key={id}><input type="checkbox" checked={values.includes(id)} onChange={(event) => onChange((event.target.checked ? [...values, id] : values.filter((value) => value !== id)).join(','))} />{translateLabels ? t(label) : label}</label>)}</div>;
}
