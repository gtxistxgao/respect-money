import { wealthTotals } from '../domain/wealth.js';
import { createLedger } from '../domain/ledger.js';
import type { RepositoryState } from './state.js';

// Called inside the repository's writer transaction. Preserve unrelated published
// rows: rebuilding the entire ledger could expose another account's staged sync.
export function removeAccounts(state: RepositoryState, ids: Set<string>, connectionInstitutions: string[] = []) {
  const institutions = new Set([...connectionInstitutions, ...state.accounts.filter(a => ids.has(a.id)).map(a => a.institution)]);
  const transactionIds = new Set(Object.entries(state.records).filter(([, row]) => ids.has(row.accountId)).map(([id]) => id));
  for (const row of state.processed) if (ids.has(row.accountId)) { transactionIds.add(row.id); transactionIds.add(row.parentId); }
  // Provider removals in older versions could leave notes/classifications with
  // no source or ledger row. Their hashed IDs cannot identify an account anymore.
  const referenced = new Set([...Object.keys(state.records), ...state.processed.flatMap(row => [row.id, row.parentId])]);
  for (const id of [...Object.keys(state.overrides), ...Object.keys(state.classifications)]) if (!referenced.has(id)) transactionIds.add(id);
  for (const id of transactionIds) {
    delete state.records[id]; delete state.overrides[id]; delete state.classifications[id];
  }
  const detachedDuplicates = new Set<string>();
  for (const [id, override] of Object.entries(state.overrides)) if (override.duplicateOf && transactionIds.has(override.duplicateOf)) {
    delete override.duplicateOf;
    override.revision++; override.updatedAt = new Date().toISOString();
    detachedDuplicates.add(id);
  }
  state.accounts = state.accounts.filter(a => !ids.has(a.id));
  state.processed = state.processed.filter(row => !ids.has(row.accountId));
  if (detachedDuplicates.size) {
    const fresh = createLedger(Object.values(state.records), state.accounts, state.overrides, state.classifications, state.ranges);
    state.processed = [...state.processed.filter(row => !detachedDuplicates.has(row.parentId)), ...fresh.filter(row => detachedDuplicates.has(row.parentId))];
  }
  state.staleAccountIds = state.staleAccountIds.filter(id => !ids.has(id));
  for (const id of ids) delete state.ranges[id];
  // Mixed jobs contain account-specific progress and error text; discard the job
  // rather than retaining misleading counts or financial details in its messages.
  for (const [id, job] of Object.entries(state.jobs)) if (job.accountIds.some(id => ids.has(id))) delete state.jobs[id];
  for (const connection of Object.values(state.connections)) {
    for (const [source, target] of Object.entries(connection.mergedAccounts || {})) if (ids.has(target)) delete connection.mergedAccounts![source];
  }
  const wealth = state.wealth;
  if (!wealth) return;
  for (const id of ids) delete wealth.balances[id];
  wealth.excludedAccountIds = wealth.excludedAccountIds.filter(id => !ids.has(id));
  const removedInstitutions = new Set([...institutions].filter(name => !Object.values(state.connections).some(c => c.institution === name)));
  wealth.errors = wealth.errors.filter(error => !removedInstitutions.has(error.name));
  for (const [date, snapshot] of Object.entries(wealth.history || {})) {
    const affected = snapshot.accounts.some(a => ids.has(a.id)) || snapshot.assets.some(a => a.debtAccountId && ids.has(a.debtAccountId))
      || snapshot.errors.some(error => removedInstitutions.has(error.name));
    if (!affected) continue;
    snapshot.accounts = snapshot.accounts.filter(a => !ids.has(a.id));
    const unknownDebt = new Set(snapshot.assets.filter(a => !a.debtAccountId && a.effectiveDebtCents === null).map(a => a.id));
    for (const asset of snapshot.assets) if (asset.debtAccountId && ids.has(asset.debtAccountId)) {
      // Keep the user's separate property/vehicle valuation and its captured debt,
      // but erase the deleted account link. Unknown historical debt stays unknown.
      if (asset.effectiveDebtCents === null) unknownDebt.add(asset.id);
      asset.debtCents = asset.effectiveDebtCents ?? 0; asset.debtAccountId = null;
    }
    Object.assign(snapshot, wealthTotals(snapshot.accounts, snapshot.assets));
    for (const asset of snapshot.assets) if (unknownDebt.has(asset.id)) {
      asset.effectiveDebtCents = null; asset.equityCents = null; snapshot.missingAccounts++;
    }
    snapshot.errors = snapshot.errors.filter(error => !removedInstitutions.has(error.name));
    snapshot.partial = snapshot.missingAccounts > 0 || snapshot.errors.length > 0 || snapshot.accounts.some(a => a.included && !a.fresh);
    if (!snapshot.accounts.length && !snapshot.assets.length) delete wealth.history![date];
  }
}
