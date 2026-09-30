import { useId, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../../i18n/index.js';
import { money } from '../../api.js';
import { useCategories } from '../../categories.js';
import { monthLabel, percentage } from './CategoryBreakdown.js';
import { categoryColor } from './category-colors.js';
import { netCategoryShares } from './category-shares.js';
import type { overviewPeriod } from './period.js';
import { CategoryTooltip } from './CategoryTooltip.js';

function donutPath(offset: number, share: number) {
  const start = offset / 100 * Math.PI * 2 - Math.PI / 2;
  const middle = start + share * Math.PI;
  const end = start + share * Math.PI * 2;
  const point = (radius: number, angle: number) => `${100 + radius * Math.cos(angle)},${100 + radius * Math.sin(angle)}`;
  // Two arcs also cover the single-category case, where the slice is a full ring.
  return `M${point(92, start)} A92,92 0 0 1 ${point(92, middle)} A92,92 0 0 1 ${point(92, end)} L${point(68, end)} A68,68 0 0 0 ${point(68, middle)} A68,68 0 0 0 ${point(68, start)} Z`;
}

export function PeriodBreakdown({ summary }: { summary: ReturnType<typeof overviewPeriod> }) {
  const titleId = useId();
  const tooltipId = useId();
  const [hovered, setHovered] = useState<{ category: string; x: number; y: number } | null>(null);
  const { label } = useCategories();
  const categories = netCategoryShares(summary.categories);
  const slices = categories.filter(item => item.share > 0).map((item, index, positive) => ({
    ...item, offset: positive.slice(0, index).reduce((sum, previous) => sum + previous.share * 100, 0),
  }));
  const active = categories.find(item => item.category === hovered?.category);
  function showTooltip(category: string, event: MouseEvent<Element> | FocusEvent<Element>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = 'clientX' in event ? event.clientX : bounds.left + bounds.width / 2;
    const y = 'clientY' in event ? event.clientY : bounds.top;
    setHovered({ category, x: Math.max(8, Math.min(x + 12, window.innerWidth - 264)), y: Math.max(8, Math.min(y + 16, window.innerHeight - 210)) });
  }
  function tooltipHandlers(category: string) {
    return {
      tabIndex: 0,
      'aria-describedby': active?.category === category ? tooltipId : undefined,
      onMouseEnter: (event: MouseEvent<Element>) => showTooltip(category, event),
      onMouseMove: (event: MouseEvent<Element>) => showTooltip(category, event),
      onMouseLeave: () => setHovered(null),
      onFocus: (event: FocusEvent<Element>) => showTooltip(category, event),
      onBlur: () => setHovered(null),
      onKeyDown: (event: KeyboardEvent<Element>) => { if (event.key === 'Escape') setHovered(null); },
    };
  }
  return <section className="category-panel period-breakdown" aria-labelledby={titleId}>
    <div className="chart-heading"><div><h2 id={titleId}>{t('Spending by category for selected period')}</h2><p>{summary.months.length > 0 && <>{monthLabel(summary.months[0].month)} — {monthLabel(summary.months.at(-1)!.month)}</>}</p></div><span className="currency-pill">USD</span></div>
    <div className="period-donut">
      <svg viewBox="0 0 200 200" role="group" aria-label={t('Category shares for selected period')}>
        <circle cx="100" cy="100" r="80" fill="none" stroke="var(--line)" strokeWidth="24" />
        {slices.map(item => <path key={item.category} className="period-donut-slice" role="img" aria-label={`${label(item.category)}: ${money(item.netExpenseCents)} (${percentage(item.share)})`} {...tooltipHandlers(item.category)} fill={categoryColor(item.category)} d={donutPath(item.offset, item.share)} />)}
      </svg>
      <div className="period-donut-total"><span>{t('Net spending')}</span><strong>{money(summary.expenseCents)}</strong></div>
    </div>
    {categories.length > 0 ? <ul className="period-category-list" aria-label={t('Category spending amounts and shares')}>
      {categories.map(item => <li key={item.category} {...tooltipHandlers(item.category)}>
        <span className="period-category-label"><i style={{ background: categoryColor(item.category) }} aria-hidden="true" /><span>{label(item.category)}</span></span>
        <span className="period-category-amount">{money(item.netExpenseCents)}</span>
        <strong className="period-category-share">{item.netExpenseCents < 0 ? t('Net refund') : percentage(item.share)}</strong>
      </li>)}
    </ul> : <p className="period-category-empty">{t('No eligible spending in this period.')}</p>}
    {categories.some(item => item.netExpenseCents < 0) && <p className="chart-note">{t('Shares use positive net spending. Net refunds are listed separately.')}</p>}
    {active && hovered && createPortal(<CategoryTooltip id={tooltipId} category={active.category} label={label(active.category)} amount={active.netExpenseCents} share={active.share} months={summary.months} x={hovered.x} y={hovered.y} />, document.body)}
  </section>;
}
