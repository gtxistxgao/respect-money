import type { RepositoryState } from '../storage/repository.js';
import { normalize } from './ledger.js';
import { today } from '../../shared/models.js';

export function historyFloor(reference = today(), days = 730) {
  return new Date(Date.parse(`${reference.slice(0, 10)}T12:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
}

export function accountCoverage(state: RepositoryState) {
  const records = Object.values(state.records).map(normalize).filter((r) => !r.pending && !r.removed);
  return state.accounts.filter((a) => a.source === 'plaid').map((account) => {
    const dates = records.filter((r) => r.accountId === account.id).map((r) => r.postedDate).sort();
    const connection = account.itemId ? state.connections[account.itemId] : undefined;
    return { accountId: account.id, accountName: account.name, accountMask: account.mask, ranges: state.ranges[account.id] || [],
      firstRecord: dates[0] || null, lastRecord: dates.at(-1) || null, recordCount: dates.length,
      historyStatus: connection?.historyStatus || 'NOT_IMPORTED', lastSyncedAt: connection?.lastSyncedAt || null,
      completeness: 'unknown' as const,
    };
  });
}
