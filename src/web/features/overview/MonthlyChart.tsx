import { t, intlLocale } from "../../../i18n/index.js";
import { useEffect, useId, useRef } from 'react';
import type { MonthSummary } from '../../../shared/models.js';
import { money } from '../../api.js';
import { monthLabel, percentage } from './CategoryBreakdown.js';

const compact = (cents: number) => new Intl.NumberFormat(intlLocale(), { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', notation: 'compact', maximumFractionDigits: 1 }).format(cents / 100);
function niceLimit(value: number) {
  if (value <= 0) return 0;
  const step = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / step) * step;
}

export function MonthlyChart({ months, selected, onSelect }: { months: MonthSummary[]; selected: string; onSelect: (month: string) => void }) {
  const scroll = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const width = Math.max(740, months.length * 78 + 86);
  const height = 330;
  const left = 70;
  const right = width - 16;
  const top = 24;
  const bottom = 244;
  const positive = Math.max(0, ...months.map((month) => Math.max(month.incomeCents, month.expenseCents)));
  const negative = Math.max(0, ...months.map((month) => -month.expenseCents));
  const step = niceLimit(Math.max(100, positive, negative) / 5);
  const maximum = positive || !negative ? Math.max(step, Math.ceil(positive / step) * step) : 0;
  const minimum = -Math.ceil(negative / step) * step;
  const y = (value: number) => bottom - (value - minimum) / (maximum - minimum) * (bottom - top);
  const zero = y(0);
  const column = (right - left) / months.length;
  const barWidth = Math.min(22, column * .23);
  const ticks = Array.from({ length: Math.round((maximum - minimum) / step) + 1 }, (_, index) => minimum + step * index);
  const selectedIndex = months.findIndex((month) => month.month === selected);
  useEffect(() => {
    const element = scroll.current;
    if (!element || selectedIndex < 0) return;
    const centerSelection = () => {
      element.scrollLeft = (left + column * (selectedIndex + .5)) * Math.max(1, element.clientWidth / width) - element.clientWidth / 2;
    };
    centerSelection();
    const observer = new ResizeObserver(centerSelection);
    observer.observe(element);
    return () => observer.disconnect();
  }, [selectedIndex, column, width]);
  return <>
    <div className="trend-scroll" ref={scroll}>
      <svg className="monthly-chart" viewBox={`0 0 ${width} ${height}`} style={{ minWidth: width }} role="group" aria-label={t("Monthly income and net spending bar chart")} aria-describedby={hintId}>
        {ticks.map((value, index) => <g key={index} aria-hidden="true"><line x1={left} x2={right} y1={y(value)} y2={y(value)} className="chart-gridline" /><text x={left - 12} y={y(value) + 4} textAnchor="end" className="axis-label">{compact(value)}</text></g>)}
        <line x1={left} x2={right} y1={zero} y2={zero} className="chart-baseline" aria-hidden="true" />
        {months.map((month, index) => {
          const center = left + column * (index + .5);
          const label = t("chart.monthTooltip", { month: monthLabel(month.month), details: month.transactionCount ? t("Income {p0}, net spending {p1}, spending-to-income ratio {p2}", { p0: money(month.incomeCents), p1: money(month.expenseCents), p2: month.spendingIncomeRatio === null ? t("No income; ratio unavailable") : percentage(month.spendingIncomeRatio) }) : t("No records"), coverage: month.incompleteAccounts.length ? t(", bank synchronization incomplete") : '' });
          return <g key={month.month} role="button" tabIndex={0} aria-label={label} aria-pressed={selected === month.month} className="chart-month" onClick={() => onSelect(month.month)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(month.month); } }}>
            <title>{label}</title>
            <rect className="chart-month-target" x={center - column / 2 + 3} y={12} width={column - 6} height={height - 24} rx="7" />
            {month.transactionCount ? <>
              <rect x={center - barWidth - 3} y={y(month.incomeCents)} width={barWidth} height={Math.max(0, zero - y(month.incomeCents))} rx="3" className="income-bar" />
              <rect x={center + 3} y={Math.min(zero, y(month.expenseCents))} width={barWidth} height={Math.abs(zero - y(month.expenseCents))} rx="3" className="expense-bar" />
              {month.incomeCents === 0 && month.expenseCents === 0 && <line x1={center - 12} x2={center + 12} y1={zero} y2={zero} className="zero-marker" />}
            </> : <text x={center} y={zero - 12} textAnchor="middle" className="axis-label">{t("No records")}</text>}
            <text x={center} y={274} textAnchor="middle" className="month-axis-label">{month.month.slice(2).replace('-', '/')}</text>
            <text x={center} y={298} textAnchor="middle" className={`ratio-axis-label ${month.spendingIncomeRatio !== null && month.spendingIncomeRatio > 1 ? 'over-budget' : ''}`}>{month.transactionCount && month.spendingIncomeRatio !== null ? percentage(month.spendingIncomeRatio) : '—'}</text>
            {month.incompleteAccounts.length > 0 && <circle cx={center + 24} cy={270} r="2.5" fill="var(--orange)" />}
          </g>;
        })}
      </svg>
    </div>
    <p className="chart-note" id={hintId}>{t("Select a month to view category shares. Below each month is net spending / income. No ratio is shown without income; negative spending means refunds exceeded spending.")}{months.some((month) => month.incompleteAccounts.length > 0) && <span className="coverage-key">{t("● Incomplete synchronization")}</span>}<span className="chart-scroll-hint">{t("Scroll horizontally to view more months.")}</span></p>
  </>;
}
