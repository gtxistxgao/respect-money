import { message as t, LocalizedError } from "../../i18n/index.js";
import { type DateRange, type SourceTransaction } from '../../shared/models.js';
import { resolveCategories, resolveCategoryId } from '../../shared/categories.js';
import { hash, inRanges, normalize } from '../domain/ledger.js';
import { CLASSIFIER_VERSION, toClassificationInput, validateClassifications, type ClassifyBatch, type ClassificationInput } from '../integrations/codex/classifier.js';
import type { Repository } from '../storage/repository.js';
import type { Publisher } from './jobs.js';

function needsModel(tx: SourceTransaction) {
  // Known financial activities and ambiguous transfers cannot be safely reinterpreted from merchant text.
  if (tx.source === 'plaid_investments' || ['payment', 'transfer', 'investment', 'reinvestment', 'excluded'].includes(tx.kind)) return false;
  if (tx.kind === 'review' && /TRANSFER|ZELLE|VENMO|REIMBURSE/i.test(`${JSON.stringify(tx.raw.personal_finance_category || {})} ${tx.description}`)) return false;
  if (tx.source === 'manual') return tx.category === 'uncategorized';
  if (tx.kind === 'income' && tx.category !== 'uncategorized') return false;
  return tx.kind === 'review' || tx.category === 'uncategorized' || tx.countrySource === 'default';
}

export class ClassificationService {
  readonly version: string;
  constructor(private repository: Repository, private classifyBatch: ClassifyBatch, fingerprint: string, private provider: 'codex' | 'claude' = 'codex') { this.version = hash([CLASSIFIER_VERSION, fingerprint, resolveCategories(repository.snapshot().settings)]); }
  publish: Publisher = async (accountIds, force, progress, range?: DateRange) => {
    const snapshot = this.repository.snapshot();
    const sources = Object.values(snapshot.records).map(normalize).filter((tx) => accountIds.includes(tx.accountId) && !tx.pending && !tx.removed && tx.currency === 'USD'
      && (tx.source === 'manual' || inRanges(tx.postedDate, snapshot.ranges[tx.accountId] || [])));
    const candidates = sources.filter((tx) => {
      const override = snapshot.overrides[tx.id];
      const reclassify = force && (!range || inRanges(tx.postedDate, [range]));
      if (override?.excluded || override?.duplicateOf || override?.splits?.length || (override?.category && !resolveCategories(snapshot.settings).find(item => item.id === override.category)?.includeInCashflow) || (override?.kind && override.category && override.country)) return false;
      if (!reclassify && override?.category && override.category !== 'uncategorized') return false;
      const cache = snapshot.classifications[tx.id];
      // Classification belongs to the transaction identity. Ordinary sync only classifies uncached work.
      return needsModel(tx) && (reclassify || !cache);
    });
    const batches: { source: SourceTransaction; input: ClassificationInput }[][] = [];
    // Keep displayed results, but invalidate forced caches before work so a retry only repeats failed batches.
    await this.repository.change((state) => {
      state.staleAccountIds = [...new Set([...state.staleAccountIds, ...candidates.map((tx) => tx.accountId)])];
      for (const tx of sources) {
        if (!needsModel(tx)) delete state.classifications[tx.id];
        else {
          const cache = state.classifications[tx.id];
          const raw = state.records[tx.id];
          // Keep the saved decision when the bank updates the same transaction, while publishing its latest data.
          // Ledger validation still flags conflicting cashflow directions and invalid splits for review.
          if (cache && raw && normalize(raw).sourceHash === tx.sourceHash) cache.sourceHash = tx.sourceHash;
        }
      }
      if (force) for (const tx of candidates) if (!range || inRanges(tx.postedDate, [range])) delete state.classifications[tx.id];
    }, false);
    let batch: (typeof batches)[number] = []; let bytes = 0;
    for (const source of candidates) {
      const input = toClassificationInput({ ...source, category: resolveCategoryId(source.category, snapshot.settings) }, snapshot.accounts.find((a) => a.id === source.accountId)!, `r${batch.length}`);
      const length = Buffer.byteLength(JSON.stringify(input));
      if (batch.length >= 50 || bytes + length > 24000) { batches.push(batch); batch = []; bytes = 0; input.ref = 'r0'; }
      batch.push({ source, input }); bytes += length;
    }
    if (batch.length) batches.push(batch);
    const failedAccounts = new Set<string>(); const errors = new Set<string>(); let failed = 0; let completed = 0;
    await progress(0, candidates.length);
    for (const batch of batches) {
      try {
        const inputs = batch.map((item) => item.input);
        const result = validateClassifications(await this.classifyBatch(inputs), inputs, resolveCategories(snapshot.settings));
        await this.repository.change((state) => {
          for (const item of batch) {
            const raw = state.records[item.source.id];
            if (!raw || normalize(raw).sourceHash !== item.source.sourceHash) { failedAccounts.add(item.source.accountId); continue; }
            const suggestion = result.find((row) => row.ref === item.input.ref)!;
            const manual = item.source.source === 'manual';
            const kind = manual ? item.source.kind : suggestion.needsReview ? 'review' : suggestion.kind;
            state.classifications[item.source.id] = {
              provider: this.provider, sourceHash: item.source.sourceHash, kind, category: suggestion.category,
              country: suggestion.country || 'US', countrySource: suggestion.country ? 'ai' : 'default',
              needsReview: kind === 'review', reason: suggestion.reason, classifierVersion: this.version, classifiedAt: new Date().toISOString(),
            };
          }
        }, false);
        completed += batch.length;
      } catch (error) {
        failed++; for (const item of batch) failedAccounts.add(item.source.accountId);
        errors.add(error instanceof LocalizedError ? error.localizedMessage : t("Classification failed validation. This batch was not published."));
      }
      await progress(completed, candidates.length);
    }
    await this.repository.change((state) => {
      const succeeded = accountIds.filter((id) => !failedAccounts.has(id));
      state.staleAccountIds = [...new Set([...state.staleAccountIds.filter((id) => !succeeded.includes(id)), ...failedAccounts])];
      for (const connection of Object.values(state.connections)) {
        const accounts = state.accounts.filter((a) => a.itemId === connection.id && accountIds.includes(a.id));
        if (accounts.length && accounts.every((a) => succeeded.includes(a.id))) connection.lastClassifiedAt = new Date().toISOString();
      }
    });
    return { failed: failed || (failedAccounts.size ? 1 : 0), total: candidates.length, errors: [...errors] };
  };
}
