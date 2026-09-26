import { ChevronRight } from 'lucide-react';
import { t } from '../../../i18n/index.js';
import { assetMoney } from './api.js';

export function AllocationPanel<K extends string>({ id, title, caption, parts, labels, colors, empty, footnote, onSelect }: {
  id: string; title: string; caption: string; parts: { kind: K; valueCents: number; percent: number }[];
  labels: Record<K, string>; colors: Record<K, string>; empty: string; footnote: string; onSelect: (kind: K) => void;
}) {
  return <section className="wealth-panel wealth-allocation" aria-labelledby={id}>
    <div className="wealth-section-heading"><h2 id={id}>{t(title)}</h2><span>{t(caption)}</span></div>
    {parts.length ? <><div className="allocation-bar" aria-hidden="true">{parts.map(part => <span key={part.kind} style={{ width: `${part.percent}%`, background: colors[part.kind] }} />)}</div>
      <ul className="allocation-list">{parts.map(part => <li key={part.kind}><button onClick={() => onSelect(part.kind)} aria-label={t('View {p0} details', { p0: t(labels[part.kind]) })}>
        <span className="allocation-kind"><i style={{ background: colors[part.kind] }} />{t(labels[part.kind])}</span><span className="allocation-percent">{part.percent.toFixed(1)}%</span><strong>{assetMoney(part.valueCents)}</strong><ChevronRight size={12} aria-hidden="true" />
      </button></li>)}</ul></> : <p className="wealth-empty">{t(empty)}</p>}
    <p className="wealth-footnote">{t(footnote)}</p>
  </section>;
}
