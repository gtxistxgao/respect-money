import { wealthSchema } from '../../shared/wealth.js';
import { applicationSettingsSchema } from '../../shared/settings.js';
import { reclassificationRuleSchema } from '../../shared/reclassification.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { accountSchema, rangeSchema, type Classification, type LedgerRow, type RawRecord, type TransactionOverride } from '../../shared/models.js';

export const connectionSchema = z.object({
  id: z.string(), institution: z.string(), institutionId: z.string().optional(), products: z.array(z.enum(['transactions', 'investments'])),
  cursor: z.string().optional(), status: z.enum(['connected', 'login_required', 'error']).default('connected'),
  lastSyncedAt: z.string().optional(), lastClassifiedAt: z.string().optional(),
  lastError: z.string().optional(), historyStatus: z.string().optional(),
  requestedHistoryDays: z.number().optional(),
  // Explicitly merged provider accounts use another connection as their source.
  mergedAccounts: z.record(z.string(), z.string()).optional(),
  createdAt: z.string().optional(),
});
export type Connection = z.infer<typeof connectionSchema>;
export const jobSchema = z.object({
  id: z.string(), type: z.enum(['sync', 'classify']), status: z.enum(['queued', 'fetching', 'classifying', 'publishing', 'succeeded', 'partial_failed', 'failed', 'interrupted']),
  accountIds: z.array(z.string()), range: rangeSchema, force: z.boolean().default(false), refresh: z.boolean().default(false),
  createdAt: z.string(), updatedAt: z.string(), progress: z.number().default(0), total: z.number().default(0),
  message: z.string().default(''), errors: z.array(z.string()).default([]),
});
export type Job = z.infer<typeof jobSchema>;
export const vaultSchema = z.object({
  userId: z.string(), tokens: z.record(z.string(), z.string()),
  links: z.record(z.string(), z.object({ token: z.string(), product: z.enum(['transactions', 'investments']).optional(), requestedProducts: z.array(z.enum(['transactions', 'investments'])).optional(), connectionId: z.string().optional(), isUpdate: z.boolean().default(false), expiresAt: z.string() })),
});
export const metadataSchema = z.object({
  wealth: wealthSchema.optional(),
  settings: applicationSettingsSchema.optional(),
  reclassificationRules: z.array(reclassificationRuleSchema).max(100).optional(),
  schemaVersion: z.literal(1), revision: z.number().int().nonnegative(),
  accounts: z.array(accountSchema), connections: z.record(z.string(), connectionSchema),
  ranges: z.record(z.string(), z.array(rangeSchema)), jobs: z.record(z.string(), jobSchema),
  staleAccountIds: z.array(z.string()).default([]),
});
type Metadata = z.infer<typeof metadataSchema>;
export type RepositoryState = Metadata & {
  vault: z.infer<typeof vaultSchema>;
  records: Record<string, RawRecord>;
  overrides: Record<string, TransactionOverride>;
  classifications: Record<string, Classification>;
  processed: LedgerRow[];
};

export function emptyState(): RepositoryState {
  return { schemaVersion: 1, revision: 0, accounts: [], connections: {}, ranges: {}, jobs: {}, staleAccountIds: [], records: {}, overrides: {}, classifications: {}, processed: [], vault: { userId: randomUUID(), tokens: {}, links: {} } };
}
