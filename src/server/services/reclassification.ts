import { randomUUID } from 'node:crypto';
import { message as t, LocalizedError } from '../../i18n/index.js';
import { confirmedCategoryKind, overrideSchema, type LedgerRow } from '../../shared/models.js';
import type { ReclassificationPreview, ReclassificationRuleInput } from '../../shared/reclassification.js';
import { AppError, normalize } from '../domain/ledger.js';
import { PATTERN_BATCH_SIZE, matchPatternBatch, type MatchPatterns, type PatternTransaction } from '../integrations/codex/pattern-matcher.js';
import type { Repository, RepositoryState } from '../storage/repository.js';

function assertAvailable(state: RepositoryState) {
  if (Object.values(state.jobs).some((job) => ['queued', 'fetching', 'classifying', 'publishing'].includes(job.status)) || state.accounts.some((a) => a.enabled && state.staleAccountIds.includes(a.id))) {
    throw new AppError(t('Finish synchronization and publish the ledger before reclassifying.'), 409);
  }
}
function eligible(row: LedgerRow, state: RepositoryState, rule: ReclassificationRuleInput) {
  return state.accounts.some((a) => a.id === row.accountId && a.enabled) && !row.pending && !row.removed && !row.excluded && !row.splitId && !row.splitCount
    && !state.overrides[row.parentId]?.duplicateOf && row.currency === 'USD'
    && !['payment', 'investment', 'reinvestment', 'excluded'].includes(row.kind)
    && (rule.direction === 'all' || (rule.direction === 'outgoing' ? row.cashflowCents < 0 : row.cashflowCents > 0));
}

export class ReclassificationService {
  private previews = new Map<string, { value: ReclassificationPreview; createdAt: number; accountIds: string[] }>();
  private running?: Promise<void>;
  constructor(private repository: Repository, private matcher: () => MatchPatterns) {}
  async save(input: ReclassificationRuleInput, id?: string, revision?: number) {
    return this.repository.change((state) => {
      const rules = state.reclassificationRules ??= [];
      const previous = id ? rules.find((r) => r.id === id) : undefined;
      if (id && (!previous || previous.revision !== revision)) throw new AppError(t('This rule changed. Reload it before saving.'), 409);
      if (!id && rules.length >= 100) throw new AppError(t('You can save up to 100 reclassification rules.'));
      const rule = { ...input, id: id || randomUUID(), revision: (previous?.revision || 0) + 1 };
      if (previous) rules[rules.indexOf(previous)] = rule; else rules.push(rule);
      return rule;
    }, false);
  }
  async remove(id: string, revision: number) {
    await this.repository.change((state) => {
      const rule = state.reclassificationRules?.find((r) => r.id === id);
      if (!rule || rule.revision !== revision) throw new AppError(t('This rule changed. Reload it before saving.'), 409);
      state.reclassificationRules = state.reclassificationRules!.filter((r) => r.id !== id);
    }, false);
  }
  get(id: string) {
    const preview = this.previews.get(id);
    const accounts = new Set(this.repository.snapshot().accounts.map(a => a.id));
    if (!preview || preview.accountIds.some(id => !accounts.has(id)) || (preview.value.status !== 'scanning' && Date.now() - preview.createdAt > 60 * 60 * 1000)) {
      this.previews.delete(id);
      throw new AppError(t('This preview expired. Scan again.'), 404);
    }
    return structuredClone(preview.value);
  }
  latest() {
    const id = [...this.previews.keys()].at(-1);
    if (!id) return null;
    try { return this.get(id); } catch { return null; }
  }
  start(ruleId: string) {
    if (this.running) throw new AppError(t('A reclassification scan is already running.'), 409);
    const state = this.repository.snapshot();
    assertAvailable(state);
    const rule = state.reclassificationRules?.find((r) => r.id === ruleId);
    if (!rule) throw new AppError(t('Reclassification rule not found.'), 404);
    const rows = state.processed.filter((row) => eligible(row, state, rule));
    const candidates = rows.filter((row) => row.category !== rule.category);
    if (candidates.length > 20000) throw new AppError(t('Too many transactions to scan. Disable some accounts and retry.'));
    for (const [id, saved] of this.previews) if (Date.now() - saved.createdAt > 60 * 60 * 1000) this.previews.delete(id);
    while (this.previews.size >= 5) this.previews.delete(this.previews.keys().next().value!);
    const preview: ReclassificationPreview = { id: randomUUID(), rule, status: 'scanning', scanned: 0, total: candidates.length, skipped: state.processed.length - candidates.length, matches: [] };
    this.previews.set(preview.id, { value: preview, createdAt: Date.now(), accountIds: state.accounts.map(account => account.id) });
    const matcher = this.matcher(); // Freeze model configuration for this scan.
    this.running = this.scan(preview, candidates, matcher).finally(() => {
      const saved = this.previews.get(preview.id);
      if (saved) saved.createdAt = Date.now();
      this.running = undefined;
    });
    return structuredClone(preview);
  }
  private async scan(preview: ReclassificationPreview, rows: LedgerRow[], matcher: MatchPatterns) {
    try {
      for (let offset = 0; offset < rows.length; offset += PATTERN_BATCH_SIZE) {
        const batch = rows.slice(offset, offset + PATTERN_BATCH_SIZE);
        const inputs: PatternTransaction[] = batch.map((row, index) => ({
          ref: `r${index}`, description: row.description.slice(0, 500), merchant: row.merchant.slice(0, 500), postedDate: row.postedDate, cashflowCents: row.cashflowCents,
        }));
        const rowsByRef = new Map(inputs.map((input, index) => [input.ref, batch[index]]));
        const result = await matchPatternBatch(matcher, preview.rule, inputs);
        // Disconnect may complete while the model is responding. Never publish
        // matches from removed accounts or resurrect an invalidated preview.
        const accounts = new Set(this.repository.snapshot().accounts.map(a => a.id));
        const saved = this.previews.get(preview.id);
        if (!saved || saved.accountIds.some(id => !accounts.has(id))) {
          this.previews.delete(preview.id); return;
        }
        for (const match of result) {
          const row = rowsByRef.get(match.ref)!;
          preview.matches.push({ id: row.parentId, version: row.version, description: row.description, postedDate: row.postedDate, accountName: row.accountName,
            cashflowCents: row.cashflowCents, category: row.category, classificationSource: row.classificationSource, reason: match.reason });
        }
        preview.scanned += batch.length;
      }
      preview.status = 'ready';
    } catch (error) {
      preview.status = 'failed'; preview.matches = [];
      preview.error = error instanceof LocalizedError ? error.localizedMessage : t('The scan failed. No categories were changed. Scan again.');
    }
  }
  async apply(id: string, ids: string[]) {
    const preview = this.get(id);
    if (preview.status !== 'ready') throw new AppError(t('Wait for a successful scan before applying categories.'), 409);
    const selected = new Set(ids);
    const allowed = new Set(preview.matches.map((row) => row.id));
    if (!selected.size || selected.size !== ids.length || ids.some((id) => !allowed.has(id))) throw new AppError(t('Select transactions from this preview.'));
    const applied = await this.repository.change((state) => {
      assertAvailable(state);
      const rule = state.reclassificationRules?.find((r) => r.id === preview.rule.id);
      if (!rule || rule.revision !== preview.rule.revision) throw new AppError(t('This rule changed. Scan again before applying.'), 409);
      const rows = new Map(state.processed.map((row) => [row.parentId, row]));
      for (const match of preview.matches.filter((row) => selected.has(row.id))) {
        const row = rows.get(match.id);
        if (!row || !eligible(row, state, rule) || row.category !== match.category || row.classificationSource !== match.classificationSource) throw new AppError(t('A matched transaction changed. Scan again before applying.'), 409);
        this.repository.assertVersion(state, match.id, match.version);
        const source = normalize(state.records[match.id]);
        const previous = state.overrides[match.id];
        const kind = row.kind === 'review' || previous?.kind === 'review' ? confirmedCategoryKind(source.kind, rule.category, source.cashflowCents) : previous?.kind;
        state.overrides[match.id] = overrideSchema.parse({ ...previous, category: rule.category, ...(kind ? { kind } : {}), revision: (previous?.revision || 0) + 1, updatedAt: new Date().toISOString() });
      }
      return selected.size;
    });
    const saved = this.previews.get(id)?.value;
    if (saved) { saved.status = 'applied'; saved.applied = applied; }
    return { applied };
  }
  async close() { await this.running; }
}
