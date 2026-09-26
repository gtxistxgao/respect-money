import { z } from 'zod';

export const defaultUsdCnyRate = 6.7;

export const applicationSettingsSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  // Keep older stored settings unchanged; resolve the default when reading.
  usdCnyRate: z.number().positive().max(1000).optional(),
  port: z.number().int().min(1).max(65535),
  plaidEnv: z.enum(['sandbox', 'production']),
  plaidClientId: z.string().trim().max(200),
  plaidSecret: z.string().trim().max(1000),
  plaidRedirectUri: z.union([z.literal(''), z.url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol))]),
  codexBin: z.string().trim().min(1).max(1000),
  codexModel: z.string().trim().max(200).regex(/^[a-zA-Z0-9._:/-]*$/),
  codexTimeoutMs: z.number().int().min(1000).max(600000),
  classificationPrompt: z.string().min(1).max(30000).refine((value) => value.trim().length > 0),
});
export type ApplicationSettings = z.infer<typeof applicationSettingsSchema>;
export type PublicSettings = Omit<ApplicationSettings, 'plaidSecret'> & {
  usdCnyRate: number; hasPlaidSecret: boolean; defaultPrompt: string; runningPort: number;
};
export type ModelOption = { model: string; displayName: string; isDefault: boolean };
export const settingsUpdateSchema = applicationSettingsSchema.omit({ revision: true }).partial().extend({
  revision: z.number().int().nonnegative(), clearPlaidSecret: z.boolean().optional(),
});
