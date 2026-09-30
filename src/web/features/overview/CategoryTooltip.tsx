import { t } from '../../../i18n/index.js';
import type { MonthSummary } from '../../../shared/models.js';
import { money } from '../../api.js';
import { monthLabel, percentage } from './CategoryBreakdown.js';
import { categoryColor } from './category-colors.js';
import { categoryMonthlySpending } from './period.js';

export function CategoryTooltip({ id, category, label, amount, share, months, x, y }: {
  id: string; category: string; label: string; amount: number; share: number; months: MonthSummary[]; x: number; y: number;
}) {
  const values = categoryMonthlySpending(months, category);
  const maximum = Math.max(1, ...values.map(item => item.netExpenseCents));
  const minimum = Math.min(0, ...values.map(item => item.netExpenseCents));
  const chartY = (value: number) => 58 - (value - minimum) / (maximum - minimum) * 48;
  const points = values.map((item, index) => ({ ...item, x: values.length === 1 ? 116 : 8 + index / (values.length - 1) * 216, y: chartY(item.netExpenseCents) }));
  const color = categoryColor(category);
  return <div id={id} role="tooltip" className="category-hover-tooltip" style={{ left: x, top: y }}>
    <div className="category-tooltip-heading"><i style={{ background: color }} /><strong>{label}</strong></div>
    <div className="category-tooltip-value"><strong>{money(amount)}</strong><span>{percentage(share)}</span></div>
    <div className="category-tooltip-chart-label">{t('Monthly net spending')}</div>
    <svg viewBox="0 0 232 78" role="img" aria-label={t('Monthly spending distribution for {category}', { category: label })}>
      <line x1="8" x2="224" y1={chartY(0)} y2={chartY(0)} stroke="var(--border)" strokeDasharray="3 3" />
      <polyline points={points.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      {points.map(point => <circle key={point.month} cx={point.x} cy={point.y} r="2.5" fill={color}><title>{`${monthLabel(point.month)}: ${money(point.netExpenseCents)}`}</title></circle>)}
      {points.length > 0 && <><text x="8" y="75">{points[0].month.replace('-', '/')}</text><text x="224" y="75" textAnchor="end">{points.length > 1 ? points.at(-1)!.month.replace('-', '/') : ''}</text></>}
    </svg>
  </div>;
}
