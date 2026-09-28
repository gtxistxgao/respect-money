import { ArrowLeftRight, Baby, Banknote, BriefcaseBusiness, Car, ChartNoAxesCombined, Clapperboard, HeartPulse, House, Landmark, Plane, Shapes, ShoppingBag, ShoppingBasket, TrendingUp, Utensils, type LucideIcon } from 'lucide-react';
import type { Category } from '../shared/models.js';

const icons: Record<Category, LucideIcon> = {
  dining: Utensils, groceries: ShoppingBasket, housing: House, transport: Car,
  shopping: ShoppingBag, health: HeartPulse, childcare: Baby, entertainment: Clapperboard, travel: Plane,
  side_business_expenses: BriefcaseBusiness, salary: Banknote, investments: TrendingUp, interest: Landmark, dividends: ChartNoAxesCombined,
  investment_transaction: ChartNoAxesCombined, internal_transfer: ArrowLeftRight, uncategorized: Shapes,
};

export function CategoryIcon({ category, size = 16, className }: { category: Category; size?: number; className?: string }) {
  const Icon = icons[category];
  return <Icon className={className} size={size} strokeWidth={1.75} aria-hidden="true" />;
}
