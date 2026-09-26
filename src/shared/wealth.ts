import { z } from 'zod';
import { accountSchema, dateSchema, today, type Account } from './models.js';

export const assetKinds = ['cash', 'stocks', 'funds', 'bonds', 'property', 'vehicle', 'investment', 'other'] as const;
export type AssetKind = typeof assetKinds[number];
export const assetLabels: Record<AssetKind, string> = {
  cash: 'Cash and deposits', stocks: 'Stocks', funds: 'Funds and ETFs', bonds: 'Bonds',
  property: 'Real estate', vehicle: 'Vehicles', investment: 'Other investments', other: 'Other assets',
};
const amount = z.number().int().nonnegative().max(1_000_000_000_000);
export const assetInput = z.object({
  name: z.string().trim().min(1).max(100), kind: z.enum(assetKinds),
  valueCents: amount, debtCents: amount,
  address: z.string().trim().max(300).default(''), vehicleModel: z.string().trim().max(150).default(''),
  valuationDate: dateSchema.refine((date) => date >= '1900-01-01' && date <= today()),
  debtAccountId: z.string().max(100).nullable().default(null),
}).strict().refine((value) => !value.debtAccountId || value.debtCents === 0);
export const manualAssetSchema = assetInput.safeExtend({ id: z.string(), revision: z.number().int().nonnegative() });
export type ManualAsset = z.infer<typeof manualAssetSchema>;
export type AssetInput = z.infer<typeof assetInput>;
export const allocationSchema = z.object({ kind: z.enum(assetKinds), valueCents: z.number().int().nonnegative().safe() });
export const balanceSchema = z.object({
  netCents: z.number().int().safe().nullable(), currency: z.string(), debtAccount: z.boolean(),
  fetchedAt: z.string(), allocation: z.array(allocationSchema), allocationIncomplete: z.boolean(),
});
export type AccountBalance = z.infer<typeof balanceSchema>;
export const wealthSnapshotSchema = z.object({
  date: dateSchema, capturedAt: z.string(), usdCnyRate: z.number().positive(),
  assetsCents: z.number().int().nonnegative().safe(), debtsCents: z.number().int().nonnegative().safe(), netWorthCents: z.number().int().safe(),
  missingAccounts: z.number().int().nonnegative(), partial: z.boolean(),
  accounts: z.array(z.object({ id: z.string(), name: z.string(), institution: z.string(), mask: z.string(), type: accountSchema.shape.type.optional(), included: z.boolean(), fresh: z.boolean(), balance: balanceSchema.nullable() })),
  assets: z.array(manualAssetSchema.safeExtend({ effectiveDebtCents: z.number().int().safe().nullable(), equityCents: z.number().int().safe().nullable() })),
  allocation: z.array(allocationSchema.extend({ percent: z.number() })),
  errors: z.array(z.object({ name: z.string(), error: z.string() })),
});
export type WealthSnapshot = z.infer<typeof wealthSnapshotSchema>;
export type WealthHistoryEntry = Pick<WealthSnapshot, 'date' | 'capturedAt' | 'assetsCents' | 'debtsCents' | 'netWorthCents' | 'partial'>;
export const wealthSchema = z.object({
  // Optional to preserve existing SQLite metadata and backup digests.
  history: z.record(dateSchema, wealthSnapshotSchema).optional(),
  assets: z.array(manualAssetSchema).max(1000), balances: z.record(z.string(), balanceSchema),
  // Retained only for older backups; all current accounts are included.
  excludedAccountIds: z.array(z.string()), lastAttemptAt: z.string().nullable(),
  errors: z.array(z.object({ name: z.string(), error: z.string() })),
});
export const emptyWealth = (): z.infer<typeof wealthSchema> => ({ assets: [], balances: {}, excludedAccountIds: [], lastAttemptAt: null, errors: [] });
export type WealthAccount = {
  id: string; name: string; institution: string; mask: string; type?: Account['type']; included: boolean; balance: AccountBalance | null;
};
export type WealthSummary = {
  usdCnyRate: number;
  assetsCents: number; debtsCents: number; netWorthCents: number; missingAccounts: number;
  allocation: { kind: AssetKind; valueCents: number; percent: number }[];
  accounts: WealthAccount[]; assets: (ManualAsset & { effectiveDebtCents: number | null; equityCents: number | null })[];
  refreshing: boolean; needsRefresh: boolean; lastAttemptAt: string | null; errors: { name: string; error: string }[];
};
