import { z } from 'zod';

export const bankingProducts = ['transactions', 'investments'] as const;
export type BankingProduct = typeof bankingProducts[number];
export const linkCompletionSchema = z.object({
  sessionId: z.string(), publicToken: z.string().max(1000).optional(),
  institution: z.string().min(1).max(100).default('Bank'), institutionId: z.string().max(200).optional(),
  selectedAccountIds: z.array(z.string()).max(100).optional(),
  accounts: z.array(z.object({ id: z.string(), name: z.string().max(200), mask: z.string().max(20).nullable(), type: z.string().max(50) })).max(100).optional(),
});
export type LinkCompletion = z.infer<typeof linkCompletionSchema>;
