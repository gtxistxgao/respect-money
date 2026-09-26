import { message as t } from "../../i18n/index.js";
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { classificationSchema, ledgerRowSchema, overrideSchema, type RawRecord } from '../../shared/models.js';
import { AppError, normalize } from '../domain/ledger.js';
import { metadataSchema, vaultSchema, type RepositoryState } from './state.js';

export function validateState(state: RepositoryState) {
  // Validate without replacing values with Zod's parsed output: raw object keys and
  // optional fields must round-trip unchanged, including their source-hash semantics.
  metadataSchema.parse(state); vaultSchema.parse(state.vault);
  z.record(z.string(), classificationSchema).parse(state.classifications);
  z.record(z.string(), overrideSchema).parse(state.overrides);
  const accounts = new Set(state.accounts.map((account) => account.id));
  if (accounts.size !== state.accounts.length) throw new AppError(t("Duplicate account IDs."), 503);
  for (const [id, record] of Object.entries(state.records)) {
    const tx = normalize(record as RawRecord);
    if (id !== tx.id || !accounts.has(record.accountId)) throw new AppError(t("Invalid source transaction ID or account mapping."), 503);
  }
  const processed = new Set<string>();
  for (const row of state.processed) {
    ledgerRowSchema.parse(row);
    if (processed.has(row.id) || !accounts.has(row.accountId)) throw new AppError(t("Invalid ledger row ID or account mapping."), 503);
    processed.add(row.id);
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}
export const stateDigest = (state: RepositoryState) => createHash('sha256').update(JSON.stringify(canonical(state))).digest('hex');
export function stateCounts(state: RepositoryState) {
  return { accounts: state.accounts.length, connections: Object.keys(state.connections).length, records: Object.keys(state.records).length,
    bankRecords: Object.values(state.records).filter((row) => row.source !== 'manual').length, manualRecords: Object.values(state.records).filter((row) => row.source === 'manual').length,
    overrides: Object.keys(state.overrides).length, classifications: Object.keys(state.classifications).length, processed: state.processed.length,
    jobs: Object.keys(state.jobs).length, rangeAccounts: Object.keys(state.ranges).length, staleAccounts: state.staleAccountIds.length,
    tokens: Object.keys(state.vault.tokens).length, linkSessions: Object.keys(state.vault.links).length };
}
