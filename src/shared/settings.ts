import { z } from 'zod';
import { categoryDefinitionsSchema, categoryIdSchema } from './categories.js';

export const defaultUsdCnyRate = 6.7;
export const displayConversionSchema = z.strictObject({
  enabled: z.boolean(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  rate: z.number().positive(),
});
export type DisplayConversion = z.infer<typeof displayConversionSchema>;
// Resolve legacy settings and snapshots without rewriting their stored data.
export function resolveDisplayConversion(value?: { displayConversion?: DisplayConversion; usdCnyRate?: number }): DisplayConversion {
  return value?.displayConversion ?? { enabled: true, currency: 'CNY', rate: value?.usdCnyRate ?? defaultUsdCnyRate };
}

export const applicationSettingsSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  categoryDefinitions: categoryDefinitionsSchema.optional(),
  categoryRedirects: z.record(categoryIdSchema, categoryIdSchema).optional(),
  // Keep older stored settings unchanged; resolve the default when reading.
  usdCnyRate: z.number().positive().max(1000).optional(),
  displayConversion: displayConversionSchema.optional(),
  port: z.number().int().min(1).max(65535),
  plaidEnv: z.enum(['sandbox', 'production']),
  plaidClientId: z.string().trim().max(200),
  plaidSecret: z.string().trim().max(1000),
  plaidRedirectUri: z.union([z.literal(''), z.url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol))]),
  // Optional for existing databases and backups; missing provider means Codex.
  classificationProvider: z.enum(['codex', 'claude']).optional(),
  claudeBin: z.string().trim().min(1).max(1000).optional(),
  claudeModel: z.string().trim().max(200).regex(/^[a-zA-Z0-9._:/-]*$/).optional(),
  claudeTimeoutMs: z.number().int().min(1000).max(600000).optional(),
  codexBin: z.string().trim().min(1).max(1000),
  codexModel: z.string().trim().max(200).regex(/^[a-zA-Z0-9._:/-]*$/),
  codexTimeoutMs: z.number().int().min(1000).max(600000),
  classificationPrompt: z.string().min(1).max(30000).refine((value) => value.trim().length > 0),
});
export type ApplicationSettings = z.infer<typeof applicationSettingsSchema>;
export type PublicSettings = Omit<ApplicationSettings, 'plaidSecret'> & {
  displayConversion: DisplayConversion; usdCnyRate: number; hasPlaidSecret: boolean; defaultPrompt: string; runningPort: number;
};
export type ModelOption = { model: string; displayName: string; isDefault: boolean };
export const settingsUpdateSchema = applicationSettingsSchema.omit({ revision: true, categoryDefinitions: true, categoryRedirects: true }).partial().extend({
  revision: z.number().int().nonnegative(), clearPlaidSecret: z.boolean().optional(),
});
