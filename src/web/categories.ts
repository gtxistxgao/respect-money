import { useQuery } from '@tanstack/react-query';
import { api } from './api.js';
import { canonicalCategory, defaultCategories, type CategoryDefinition } from '../shared/categories.js';
import { t } from '../i18n/index.js';
export type CategoryCatalog = { revision: number; categories: CategoryDefinition[] };
export function categoryName(category: CategoryDefinition): string {
  return defaultCategories.some(row => row.id === category.id && row.name === category.name) ? t(category.name) : category.name;
}
export function useCategories() {
  const query = useQuery({ queryKey: ['categories'], queryFn: () => api<CategoryCatalog>('/categories') });
  const definitions = query.data?.categories ?? defaultCategories;
  const label = (id: string) => { const category = definitions.find(row => row.id === canonicalCategory(id)); return category ? categoryName(category) : id; };
  return { ...query, definitions, options: definitions.map(row => [row.id, categoryName(row)] as const), label };
}
