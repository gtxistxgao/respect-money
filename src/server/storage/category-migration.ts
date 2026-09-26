import { categorySchema, type Category } from '../../shared/models.js';
import type { RepositoryState } from './state.js';

// Update saved classifications without rebuilding unpublished/stale ledger rows.
// Raw provider/manual payloads and their source hashes remain unchanged.
export function mergeInvestmentCategories(state: RepositoryState) {
  let changed = false;
  const merge = (value: { category?: Category }) => {
    if (value.category === undefined) return false;
    const category = categorySchema.parse(value.category);
    if (category === value.category) return false;
    value.category = category; changed = true; return true;
  };
  const published = new Map(state.processed.filter((row) => !row.splitId).map((row) => [row.parentId, row]));
  for (const [id, override] of Object.entries(state.overrides)) {
    // A positive fee reimbursement already resolved as a refund must stay a refund.
    if (merge(override) && override.kind === undefined && published.get(id)?.kind === 'refund') override.kind = 'refund';
    override.splits?.forEach(merge);
  }
  Object.values(state.classifications).forEach(merge);
  state.processed.forEach(merge);
  state.reclassificationRules?.forEach(merge);
  return changed;
}
