import { Select } from './Select.js';
import { useEffect, useRef } from 'react';
import { t, shortMonth, transactionCount } from "../i18n/index.js";
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import { today } from '../shared/models.js';
import { api } from './api.js';
import { ErrorNotice } from './components.js';

type MonthEntry = { month: string; count: number };

export function MonthNavigation() {
  const [params, setParams] = useSearchParams();
  const currentMonth = today().slice(0, 7);
  const currentYear = Number(currentMonth.slice(0, 4));
  const month = params.get('month') || currentMonth;
  const navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navigation.current;
    const selected = nav?.querySelector<HTMLElement>('[aria-current="date"]');
    if (!nav || !selected || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft += selected.getBoundingClientRect().left - nav.getBoundingClientRect().left - (nav.clientWidth - selected.clientWidth) / 2;
  }, [month]);
  const year = Number(month.slice(0, 4));
  const months = useQuery({ queryKey: ['months'], queryFn: () => api<MonthEntry[]>('/accounting/months') });
  const counts = new Map(months.data?.map((entry) => [entry.month, entry.count]));
  const years = Array.from({ length: currentYear - Math.min(1900, year) + 1 }, (_, index) => currentYear - index);
  const lastMonth = year === currentYear ? Number(currentMonth.slice(5)) : 12;
  const visibleMonths = Array.from({ length: lastMonth }, (_, index) => `${year}-${String(lastMonth - index).padStart(2, '0')}`);
  function changeMonth(value: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set('month', value); else next.delete('month');
      next.delete('page');
      return next;
    });
  }
  return <section className="month-rail" aria-label={t("Monthly ledger")}>
    <div className="rail-title"><CalendarDays size={16} /><span>{t("Select year")}</span></div>
    <div className="year-picker"><Select aria-label={t("Select year")} value={String(year)} onValueChange={(nextValue) => {
      const selectedYear = Number(nextValue);
      const selectedMonth = Math.min(Number(month.slice(5)), selectedYear === currentYear ? Number(currentMonth.slice(5)) : 12);
      changeMonth(`${selectedYear}-${String(selectedMonth).padStart(2, '0')}`);
    }}>{years.map((value) => <option key={value} value={value}>{t("year.label", { year: value })}</option>)}</Select></div>
    <ErrorNotice error={months.error} />
    <nav ref={navigation} aria-label={t("Month navigation")}>{visibleMonths.map((value) => <button key={value} className={`month-button ${value === month ? 'active' : ''}`} aria-current={value === month ? 'date' : undefined} onClick={() => changeMonth(value)}><span>{shortMonth(value)}</span><small>{counts.get(value) ? transactionCount(counts.get(value)!) : '—'}</small></button>)}</nav>
  </section>;
}
