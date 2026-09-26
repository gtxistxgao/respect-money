import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { intlLocale, t } from '../../../i18n/index.js';

type Row = { id: string; institution: string };
type Column<T> = { key: string; label: string; value?: (row: T) => string | number; render: (row: T) => ReactNode };

export function InstitutionTable<T extends Row>({ rows, columns, label, className }: { rows: T[]; columns: Column<T>[]; label: string; className: string }) {
  const [sort, setSort] = useState({ key: 'institution', descending: false });
  const collator = new Intl.Collator(intlLocale(), { numeric: true, sensitivity: 'base' });
  const institution = (row: T) => row.institution.trim().toLowerCase();
  const institutions = [...new Set(rows.map(institution))].sort(collator.compare);
  const value = columns.find(column => column.key === sort.key)?.value;
  const sorted = [...rows].sort((a, b) => {
    const left = value?.(a) ?? ''; const right = value?.(b) ?? '';
    const order = typeof left === 'number' && typeof right === 'number' ? left - right : collator.compare(String(left), String(right));
    return order * (sort.descending ? -1 : 1) || collator.compare(institution(a), institution(b)) || a.id.localeCompare(b.id);
  });
  return <div className="account-table-scroll settings-table-scroll" role="region" aria-label={label} tabIndex={0}>
    <table className={`account-data-table settings-data-table ${className}`} aria-label={label}>
      <thead><tr>{columns.map(column => {
        const active = column.key === sort.key;
        const Icon = active ? sort.descending ? ArrowDown : ArrowUp : ArrowUpDown;
        return <th key={column.key} scope="col" className={`settings-col-${column.key}`} aria-sort={column.value ? active ? sort.descending ? 'descending' : 'ascending' : 'none' : undefined}>{column.value ? <button onClick={() => setSort({ key: column.key, descending: active ? !sort.descending : false })}>{t(column.label)}<Icon size={12} aria-hidden="true" /></button> : <span className="settings-column-label">{t(column.label)}</span>}</th>;
      })}</tr></thead>
      <tbody>{sorted.map((row, index) => <tr key={row.id} className={`institution-tone-${institutions.indexOf(institution(row)) % 3}${index > 0 && institution(sorted[index - 1]) !== institution(row) ? ' institution-start' : ''}`}>{columns.map(column => <td key={column.key} className={`settings-col-${column.key}`}>{column.render(row)}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}
