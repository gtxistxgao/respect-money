import { normalize } from './ledger.js';
import type { RepositoryState } from '../storage/repository.js';

export function duplicateCandidates(state: RepositoryState, month: string) {
  const all = Object.values(state.records).map(normalize).filter((t) => !t.pending && !t.removed && t.currency === 'USD');
  const alreadyMatched = new Set(Object.values(state.overrides).map((o) => o.duplicateOf).filter(Boolean));
  const banks = all.filter((t) => t.source !== 'manual' && !alreadyMatched.has(t.id));
  return all.filter((t) => t.source === 'manual' && t.postedDate.startsWith(month) && !state.overrides[t.id]?.duplicateOf && !state.overrides[t.id]?.excluded).flatMap((manual) => {
    const candidates = banks.filter((bank) => bank.cashflowCents === manual.cashflowCents && Math.abs(Date.parse(bank.postedDate) - Date.parse(manual.postedDate)) <= 3 * 86400000);
    const safe = (t: typeof manual) => ({ id: t.id, description: t.description, postedDate: t.postedDate, cashflowCents: t.cashflowCents, accountName: state.accounts.find((a) => a.id === t.accountId)?.name || '' });
    return candidates.length ? [{ manual: { ...safe(manual), version: `${manual.sourceHash}:${state.overrides[manual.id]?.revision || 0}` }, candidates: candidates.map(safe) }] : [];
  });
}
