import { z } from 'zod';
import { categorySchema, type Category } from './models.js';

export const reclassificationRuleInput = z.strictObject({
  example: z.string().trim().min(3).max(2000),
  category: categorySchema,
  direction: z.enum(['outgoing', 'incoming', 'all']).default('outgoing'),
});
export const reclassificationRuleSchema = reclassificationRuleInput.extend({ id: z.string().uuid(), revision: z.number().int().positive() });
export type ReclassificationRuleInput = z.infer<typeof reclassificationRuleInput>;
export type ReclassificationRule = z.infer<typeof reclassificationRuleSchema>;
export type ReclassificationMatch = {
  id: string; version: string; description: string; postedDate: string; accountName: string;
  cashflowCents: number; category: Category; classificationSource: 'rules' | 'manual' | 'codex'; reason: string;
};
export type ReclassificationPreview = {
  id: string; rule: ReclassificationRule; status: 'scanning' | 'ready' | 'failed' | 'applied';
  scanned: number; total: number; skipped: number; matches: ReclassificationMatch[]; error?: string; applied?: number;
};
