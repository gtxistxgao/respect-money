import { useCategories } from '../../categories.js';
import { t, intlLocale, formatMonth } from "../../../i18n/index.js";
import { useId, type CSSProperties } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { type Category, type MonthSummary } from '../../../shared/models.js';
import { money } from '../../api.js';
import { CategoryIcon } from '../../CategoryIcon.js';
import { resetTableFilters } from '../accounting/filters.js';
import { netCategoryShares } from './category-shares.js';

const colors: Record<Category, string> = {
  dining: 'var(--orange)', groceries: 'var(--accent)', housing: 'var(--pink)', transport: 'var(--cyan)',
  shopping: 'var(--chart-shopping, #c4adfa)', health: 'var(--danger)', childcare: 'var(--childcare)', entertainment: 'var(--chart-entertainment, #73cabe)', travel: 'var(--chart-travel, #56c6f6)',
  side_business: 'var(--chart-business, #8bb8f0)', salary: 'var(--chart-salary, #6fc666)', investments: 'var(--chart-investments, #88d6b0)', interest: 'var(--chart-interest, #b5e6fb)', dividends: 'var(--chart-dividends, #e27dd7)', investment_transaction: 'var(--chart-activity, #92929f)', internal_transfer: 'var(--chart-activity, #92929f)', uncategorized: 'var(--chart-uncategorized, #acacb9)',
};
export const percentage = (ratio: number) => new Intl.NumberFormat(intlLocale(), { style: 'percent', maximumFractionDigits: 1 }).format(ratio);
export const monthLabel = formatMonth;

export function CategoryBreakdown({ data, accounts = '' }: { data: MonthSummary; accounts?: string }) {
  const { label: categoryLabel } = useCategories();
  const titleId = useId();
  const [params] = useSearchParams();
  const location = useLocation();
  const inLedger = location.pathname === '/';
  const selectedCategories = inLedger && (params.get('mode') || 'expense') === 'expense' ? (params.get('categories') || '').split(',') : [];
  const categories = netCategoryShares(data.categories);
  return <section className="category-panel" aria-labelledby={titleId}>
    <div className="chart-heading"><div><h2 id={titleId}>{t("Spending by category")}</h2><p>{monthLabel(data.month)}  {t("· Based on spending after refunds")}</p></div><span className="currency-pill">USD</span></div>
    {categories.length ? <ul className="category-grid" aria-label={t("Category spending amounts and shares")}>{categories.map((item) => {
      const share = item.share;
      const percent = Math.min(100, Math.max(0, share * 100));
      const selected = selectedCategories.includes(item.category);
      const query = resetTableFilters(inLedger ? params : new URLSearchParams());
      query.set('month', data.month);
      if (!selected) { query.set('mode', 'expense'); query.set('categories', item.category); }
      if (accounts) query.set('accounts', accounts);
      return <li key={item.category}><Link to={`/?${query}`} className={selected ? 'selected' : undefined} title={item.refundCents > 0 ? t('Refunds deducted: {amount}', { amount: money(item.refundCents) }) : undefined} aria-current={selected ? 'true' : undefined} style={{ '--category-color': colors[item.category] ?? 'var(--cyan)' } as CSSProperties}>
        <CategoryIcon className="category-icon" category={item.category} size={36} />
        <span className="category-item-content">
          <span className="category-item-heading"><span className="category-name" title={categoryLabel(item.category)}>{categoryLabel(item.category)}</span><span className="category-amount">{money(item.netExpenseCents)}</span><strong className="category-percentage">{item.netExpenseCents < 0 ? t('Net refund') : percentage(share)}</strong></span>
          <span className="category-share-track" role="meter" aria-label={categoryLabel(item.category)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={percentage(share)}><span style={{ width: `${percent}%` }} /></span>
        </span>
      </Link></li>;
    })}</ul> : <div className="chart-empty"><p>{data.transactionCount ? t("No eligible spending this month.") : t("No received transactions this month.")}</p></div>}
  </section>;
}
