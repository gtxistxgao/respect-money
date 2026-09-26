import { useId } from 'react';
import { intlLocale, t } from '../../../i18n/index.js';
import type { WealthHistoryEntry } from '../../../shared/wealth.js';
import { assetMoney } from './api.js';
import './balance-trends.css';

const metrics = [
  { key: 'netWorthCents', label: 'Net worth', tone: 'net' },
  { key: 'assetsCents', label: 'Total assets', tone: 'assets' },
  { key: 'debtsCents', label: 'Total debts', tone: 'debts' },
] as const;
const width = 420, height = 240, left = 76, right = 404, top = 20, bottom = 196;
const stamp = (date: string) => Date.parse(`${date}T00:00:00Z`);

function Trend({ entries, metric, selected, onSelect, hintId }: {
  entries: WealthHistoryEntry[]; metric: typeof metrics[number]; selected: string;
  onSelect: (date: string) => void; hintId: string;
}) {
  const titleId = useId();
  const values = entries.map(entry => entry[metric.key]);
  const low = Math.min(...values), high = Math.max(...values);
  const padding = Math.max((high - low) * .1, Math.abs(high) * .01, 100);
  const rawStep = (high - low + padding * 2) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 5, 10].find(value => value * magnitude >= rawStep)! * magnitude;
  const minimum = Math.floor((low - padding) / step) * step;
  const maximum = Math.ceil((high + padding) / step) * step;
  const y = (value: number) => bottom - (value - minimum) / (maximum - minimum) * (bottom - top);
  const start = stamp(entries[0].date), end = stamp(entries.at(-1)!.date);
  const x = (date: string) => start === end ? (left + right) / 2 : left + (stamp(date) - start) / (end - start) * (right - left);
  const ticks = Array.from({ length: Math.round((maximum - minimum) / step) + 1 }, (_, index) => minimum + index * step);
  const dates = entries.filter((entry, index) => index === 0 || index === entries.length - 1 || (index === Math.floor(entries.length / 2) && x(entry.date) - left > 105 && right - x(entry.date) > 105));
  const current = entries.find(entry => entry.date === selected) || entries.at(-1)!;
  const compact = (value: number) => new Intl.NumberFormat(intlLocale(), { notation: 'compact', maximumFractionDigits: 2 }).format(value / 100);
  const path = entries.map((entry, index) => `${index ? 'L' : 'M'}${x(entry.date)},${y(entry[metric.key])}`).join(' ');
  return <section className={`balance-trend balance-trend-${metric.tone}`} aria-labelledby={titleId}>
    <div className="balance-trend-heading"><h2 id={titleId}>{t(metric.label)}</h2><span>USD</span></div>
    <div className="balance-trend-value">{assetMoney(current[metric.key], 2)}</div>
    <svg viewBox={`0 0 ${width} ${height}`} className="balance-trend-chart" role="group" aria-label={t('{p0} trend', { p0: t(metric.label) })} aria-describedby={hintId}
      onClick={event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const target = (event.clientX - bounds.left) / bounds.width * width;
        const nearest = entries.reduce((best, entry) => Math.abs(x(entry.date) - target) < Math.abs(x(best.date) - target) ? entry : best);
        onSelect(nearest.date);
      }}>
      {ticks.map(value => <g key={value} aria-hidden="true"><line className={`balance-trend-grid${value === 0 ? ' balance-trend-zero' : ''}`} x1={left} x2={right} y1={y(value)} y2={y(value)} /><text className="balance-trend-axis" x={left - 10} y={y(value) + 4} textAnchor="end">{compact(value)}</text></g>)}
      <path className="balance-trend-line" d={path} aria-hidden="true" />
      <line className="balance-trend-selected" x1={x(current.date)} x2={x(current.date)} y1={top} y2={bottom} aria-hidden="true" />
      {dates.map(entry => <text key={entry.date} className="balance-trend-axis balance-trend-date" x={x(entry.date)} y={222} textAnchor={entries.length === 1 ? 'middle' : entry === entries[0] ? 'start' : entry === entries.at(-1) ? 'end' : 'middle'} aria-hidden="true">{entry.date}</text>)}
      {entries.map((entry, index) => {
        const label = `${entry.date}: ${assetMoney(entry[metric.key], 2)}${entry.partial ? ` · ${t('Partial update')}` : ''}`;
        return <g key={entry.date} data-date={entry.date} className="balance-trend-point" role="button" tabIndex={entry.date === current.date ? 0 : -1} aria-label={label} aria-pressed={entry.date === current.date}
          onClick={event => { event.stopPropagation(); onSelect(entry.date); }}
          onKeyDown={event => {
            const next = event.key === 'ArrowLeft' ? Math.max(0, index - 1) : event.key === 'ArrowRight' ? Math.min(entries.length - 1, index + 1) : event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : ['Enter', ' '].includes(event.key) ? index : undefined;
            if (next === undefined) return;
            event.preventDefault();
            onSelect(entries[next].date);
            event.currentTarget.parentElement?.querySelector<SVGGElement>(`[data-date="${entries[next].date}"]`)?.focus();
          }}>
          <title>{label}</title>
          <circle className="balance-trend-target" cx={x(entry.date)} cy={y(entry[metric.key])} r={14} />
          <circle className={`balance-trend-dot${entry.partial ? ' balance-trend-partial' : ''}`} cx={x(entry.date)} cy={y(entry[metric.key])} r={entry.date === current.date ? 5 : 3} />
        </g>;
      })}
    </svg>
  </section>;
}

export function BalanceTrends({ history, selected, onSelect }: { history: WealthHistoryEntry[]; selected: string; onSelect: (date: string) => void }) {
  const hintId = useId();
  const entries = [...history].sort((a, b) => a.date.localeCompare(b.date));
  if (!entries.length) return null;
  return <div className="balance-trends">
    <div className="balance-trends-grid">{metrics.map(metric => <Trend key={metric.key} entries={entries} metric={metric} selected={selected} onSelect={onSelect} hintId={hintId} />)}</div>
    <p className="wealth-footnote" id={hintId}>{t('Select a date on any chart to view its snapshot below. Use the left and right arrow keys to move between dates.')}{entries.some(entry => entry.partial) && <span className="balance-trends-partial-key">{t('Hollow points indicate partial updates.')}</span>}</p>
  </div>;
}
