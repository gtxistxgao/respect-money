import { Select } from '../../Select.js';
import { t } from "../../../i18n/index.js";
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, BarChart3, ChevronLeft, ChevronRight } from 'lucide-react';
import { today, type Account, type MonthSummary, type OverviewData } from '../../../shared/models.js';
import { api, money } from '../../api.js';
import { ErrorNotice, Loading } from '../../components.js';
import { CategoryBreakdown, monthLabel, percentage } from './CategoryBreakdown.js';
import { MonthlyChart } from './MonthlyChart.js';

export function Overview() {
  const [params, setParams] = useSearchParams();
  const accountFilter = params.get('accounts') || '';
  const period = params.get('period') || '12';
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => api<Account[]>('/accounts') });
  const result = useQuery({ queryKey: ['overview', accountFilter], queryFn: () => api<OverviewData>(`/accounting/overview?${new URLSearchParams({ accounts: accountFilter })}`), refetchInterval: 5000 });
  const allMonths = result.data?.months || [];
  const years = [...new Set(allMonths.map((month) => month.month.slice(0, 4)))].reverse();
  const months = period === 'all' ? allMonths : years.includes(period) ? allMonths.filter((month) => month.month.startsWith(period)) : allMonths.slice(-12);
  const requestedMonth = params.get('month') || today().slice(0, 7);
  const recordedSelection = allMonths.find((month) => month.month === requestedMonth);
  const summary = useQuery({ queryKey: ['summary', requestedMonth, accountFilter], queryFn: () => api<MonthSummary>(`/accounting/summary?${new URLSearchParams({ month: requestedMonth, ...(accountFilter ? { accounts: accountFilter } : {}) })}`), enabled: result.isSuccess && !recordedSelection });
  const selected = recordedSelection || summary.data;
  const selectionMonths = selected && !months.some((month) => month.month === selected.month) ? [...months, selected].sort((a, b) => a.month.localeCompare(b.month)) : months;
  const selectedIndex = selectionMonths.findIndex((month) => month.month === selected?.month);
  function change(key: string, value: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value); else next.delete(key);
      if (key === 'period') {
        const range = value === 'all' ? allMonths : years.includes(value) ? allMonths.filter((month) => month.month.startsWith(value)) : allMonths.slice(-12);
        if (!range.some((month) => month.month === requestedMonth) && range.length) next.set('month', range.at(-1)!.month);
      }
      return next;
    });
  }
  const detailQuery = new URLSearchParams({ month: selected?.month || requestedMonth, ...(accountFilter ? { accounts: accountFilter } : {}) });
  return <main className="overview-main">
    <div className="page-heading"><div><h1>{t('Overview')}</h1><p>{t("Compare income and spending to see where your money goes each month.")}</p></div><label className="overview-account-filter"><span>{t("Included accounts")}</span><Select aria-label={t("Filter overview accounts")} value={accountFilter} onValueChange={(nextValue) => change('accounts', nextValue)}><option value="">{t("All enabled accounts")}</option>{accounts.data?.filter((account) => account.enabled).map((account) => <option key={account.id} value={account.id}>{account.name}{account.mask && ` · ${account.mask}`}</option>)}</Select></label></div>
    <ErrorNotice error={result.error || accounts.error || summary.error} />
    {result.isPending ? <Loading label={t("Summarizing monthly cash flow…")} /> : result.data && !allMonths.length ? <section className="overview-empty"><BarChart3 size={36} /><h2>{t("Start a trend with your first record")}</h2><p>{t("No transactions have been received for these accounts. Connect a bank or add a manual entry to see monthly cash flow.")}</p><Link className="button primary" to="/">{t("Go to ledger")} <ArrowRight size={16} /></Link></section> : selected && <>
      {months.some((month) => month.stale) && <div className="notice">{t("Classification is out of date. Charts show the last successfully published ledger.")}</div>}
      <section className="trend-panel" aria-label={t("Income and spending trends")}>
        <div className="chart-heading"><div><h2>{t("Income and spending trends")}</h2><p>{monthLabel(months[0].month)} — {monthLabel(months.at(-1)!.month)}</p></div><Select aria-label={t("Trend range")} value={years.includes(period) || period === 'all' ? period : '12'} onValueChange={(nextValue) => change('period', nextValue)}><option value="12">{t("Last 12 months")}</option><option value="all">{t("All months")}</option>{years.map((year) => <option key={year} value={year}>{t("year.label", { year })}</option>)}</Select></div>
        <div className="chart-legend"><span><i className="income-key" />{t("Income")}</span><span><i className="expense-key" />{t("Net spending")}</span><span className="chart-unit">{t("USD · Same amount scale")}</span></div>
        <MonthlyChart months={months} selected={selected.month} onSelect={(month) => change('month', month)} />
      </section>
      <div className="overview-month-heading"><div className="month-stepper"><button className="icon-button" aria-label={t("View previous month")} disabled={selectedIndex <= 0} onClick={() => change('month', selectionMonths[selectedIndex - 1].month)}><ChevronLeft size={18} /></button><Select aria-label={t("View month")} value={selected.month} onValueChange={(nextValue) => change('month', nextValue)}>{selectionMonths.map((month) => <option key={month.month} value={month.month}>{monthLabel(month.month)}</option>)}</Select><button className="icon-button" aria-label={t("View next month")} disabled={selectedIndex >= selectionMonths.length - 1} onClick={() => change('month', selectionMonths[selectedIndex + 1].month)}><ChevronRight size={18} /></button></div><Link className="month-detail-link" to={`/?${detailQuery}`}>{t("View monthly ledger")} <ArrowRight size={15} /></Link></div>
      {selected.incompleteAccounts.length > 0 && <div className="notice">{t("Incomplete synchronization: {accounts}. Only received records are included.", { accounts: selected.incompleteAccounts.join(t("list.separator")) })}</div>}
      {selected.reviewCount > 0 && <div className="notice">{t("{count} transactions are awaiting review and excluded from cash flow and category shares.", { count: selected.reviewCount })}<Link className="inline-button" to={`/?${detailQuery}&mode=review`}>{t("Review now")}</Link></div>}
      {!selected.transactionCount && <div className="notice">{t("No transactions have been received this month. This does not mean actual cash flow was zero.")}</div>}
      <div className="overview-detail-grid">
        <section className="cashflow-panel" aria-label={t("Selected month's cash flow")}><div className="chart-heading"><div><h2>{monthLabel(selected.month)}</h2><p>{t("Monthly cash flow comparison")}</p></div></div>
          <dl className="cashflow-totals"><div><dt><i className="income-key" />{t("Income")}</dt><dd className="income-text">{selected.transactionCount ? money(selected.incomeCents) : '—'}</dd></div><div><dt><i className="expense-key" />{t("Net spending")}</dt><dd>{selected.transactionCount ? money(selected.expenseCents) : '—'}</dd></div><div className="cashflow-net"><dt>{t("Balance")}</dt><dd>{selected.transactionCount ? money(selected.netCents) : '—'}</dd></div></dl>
          <div className="spending-ratio"><span>{t("Net spending / income")}</span><strong className={selected.spendingIncomeRatio !== null && selected.spendingIncomeRatio > 1 ? 'over-budget' : ''}>{selected.spendingIncomeRatio === null ? '—' : percentage(selected.spendingIncomeRatio)}</strong></div>
          <div className="ratio-track" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, (selected.spendingIncomeRatio || 0) * 100))}%` }} /></div>
          <p className="chart-note">{!selected.transactionCount ? t("Waiting for transaction records.") : selected.spendingIncomeRatio === null ? t("No confirmed income this month; ratio unavailable.") : selected.spendingIncomeRatio > 1 ? t("Net spending exceeded income this month.") : selected.expenseCents < 0 ? t("Received refunds exceeded spending this month.") : t("{p0} of income went toward net spending.", { p0: percentage(selected.spendingIncomeRatio) })}</p>
        </section>
        <CategoryBreakdown data={selected} accounts={accountFilter} />
      </div>
      <p className="page-footer">{t("Only posted USD records from enabled accounts are included. Transfers, credit card payments, investment trades and records awaiting review are excluded.")}</p>
    </>}
  </main>;
}
