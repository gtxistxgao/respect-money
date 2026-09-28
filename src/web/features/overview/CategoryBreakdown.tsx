import { t, intlLocale, formatMonth } from "../../../i18n/index.js";
import { useId, type CSSProperties } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Check, ChevronRight } from 'lucide-react';
import { categoryLabel, type Category, type MonthSummary } from '../../../shared/models.js';
import { money } from '../../api.js';
import { CategoryIcon } from '../../CategoryIcon.js';
import { resetTableFilters } from '../accounting/filters.js';

const colors: Record<Category, string> = {
  dining: 'var(--orange)', groceries: 'var(--accent)', housing: 'var(--pink)', transport: 'var(--cyan)',
  shopping: 'var(--chart-shopping, #c4adfa)', health: 'var(--danger)', childcare: 'var(--childcare)', entertainment: 'var(--chart-entertainment, #73cabe)', travel: 'var(--chart-travel, #56c6f6)',
  side_business_expenses: 'var(--chart-business, #8bb8f0)', salary: 'var(--chart-salary, #6fc666)', investments: 'var(--chart-investments, #88d6b0)', interest: 'var(--chart-interest, #b5e6fb)', dividends: 'var(--chart-dividends, #e27dd7)', investment_transaction: 'var(--chart-activity, #92929f)', internal_transfer: 'var(--chart-activity, #92929f)', uncategorized: 'var(--chart-uncategorized, #acacb9)',
};
export const percentage = (ratio: number) => new Intl.NumberFormat(intlLocale(), { style: 'percent', maximumFractionDigits: 1 }).format(ratio);
export const monthLabel = formatMonth;

export function CategoryBreakdown({ data, accounts = '' }: { data: MonthSummary; accounts?: string }) {
  const titleId = useId();
  const [params] = useSearchParams();
  const location = useLocation();
  const inLedger = location.pathname === '/';
  const selectedCategories = inLedger && (params.get('mode') || 'expense') === 'expense' ? (params.get('categories') || '').split(',') : [];
  const categories = data.categories.filter((item) => item.expenseCents > 0);
  return <section className="category-panel" aria-labelledby={titleId}>
    <div className="chart-heading"><div><h2 id={titleId}>{t("Spending by category")}</h2><p>{monthLabel(data.month)}  {t("· Based on spending before refunds")}</p></div><span className="currency-pill">USD</span></div>
    {categories.length ? <ul className="category-grid" aria-label={t("Category spending amounts and shares")}>{categories.map((item) => {
      const share = data.grossExpenseCents > 0 ? item.expenseCents / data.grossExpenseCents : 0;
      const percent = Math.min(100, Math.max(0, share * 100));
      const selected = selectedCategories.includes(item.category);
      const query = resetTableFilters(inLedger ? params : new URLSearchParams());
      query.set('month', data.month);
      if (!selected) { query.set('mode', 'expense'); query.set('categories', item.category); }
      if (accounts) query.set('accounts', accounts);
      return <li key={item.category}><Link to={`/?${query}`} className={selected ? 'selected' : undefined} aria-current={selected ? 'true' : undefined} style={{ '--category-color': colors[item.category] } as CSSProperties}>
        <CategoryIcon className="category-icon" category={item.category} size={36} />
        <span className="category-item-content">
          <span className="category-item-heading"><span className="category-name">{categoryLabel(item.category)}</span>{selected ? <Check size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}</span>
          <span className="category-item-values"><span>{money(item.expenseCents)}</span><strong>{percentage(share)}</strong></span>
          <span className="category-share-track" role="meter" aria-label={categoryLabel(item.category)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={percentage(share)}><span style={{ width: `${percent}%` }} /></span>
        </span>
      </Link></li>;
    })}</ul> : <div className="chart-empty"><p>{data.transactionCount ? t("No eligible spending this month.") : t("No received transactions this month.")}</p></div>}
    <div className="category-footnote"><span>{t("Gross spending")} <strong>{money(data.grossExpenseCents)}</strong></span><span>{t("Received refunds")} <strong>{money(data.refundCents)}</strong></span><span>{t("Net spending")} <strong>{money(data.expenseCents)}</strong></span></div>
    <p className="chart-note">{t("Refunds are shown separately and excluded from category shares. Select a category to view its transactions.")}</p>
  </section>;
}
