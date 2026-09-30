import type { Category } from '../../../shared/models.js';

const colors: Record<Category, string> = {
  dining: 'var(--orange)', groceries: 'var(--accent)', housing: 'var(--pink)', transport: 'var(--cyan)',
  shopping: 'var(--chart-shopping, #c4adfa)', health: 'var(--danger)', childcare: 'var(--childcare)', entertainment: 'var(--chart-entertainment, #73cabe)', travel: 'var(--chart-travel, #56c6f6)',
  side_business: 'var(--chart-business, #8bb8f0)', salary: 'var(--chart-salary, #6fc666)', investments: 'var(--chart-investments, #88d6b0)', interest: 'var(--chart-interest, #b5e6fb)', dividends: 'var(--chart-dividends, #e27dd7)', investment_transaction: 'var(--chart-activity, #92929f)', internal_transfer: 'var(--chart-activity, #92929f)', uncategorized: 'var(--chart-uncategorized, #acacb9)',
};

export function categoryColor(category: Category): string {
  if (colors[category]) return colors[category];
  const hash = [...category].reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 0);
  return `hsl(${hash % 360} 55% 52%)`;
}
