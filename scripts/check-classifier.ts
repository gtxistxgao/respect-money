import { readConfig } from '../src/server/config.js';
import { classificationBackend } from '../src/server/integrations/ai.js';
import { validateClassifications, type ClassificationInput } from '../src/server/integrations/codex/classifier.js';

const config = readConfig();
const provider = process.argv[2] ?? config.classificationProvider ?? 'codex';
if (provider !== 'codex' && provider !== 'claude') throw new Error('Expected codex or claude.');
config.classificationProvider = provider;
const inputs: ClassificationInput[] = [{ ref: 'r0', description: 'Sakura Cafe, Tokyo Japan, restaurant lunch (fictional)', merchant: 'Sakura Cafe', postedDate: '2026-08-01', cashflowCents: -1250, accountType: 'credit', source: 'plaid_transactions', bankCategory: { primary: '', detailed: '' }, location: { city: 'Tokyo', country: null, region: null }, suggestedKind: 'expense', suggestedCategory: 'uncategorized' }];
const { classify } = classificationBackend(config);
const result = validateClassifications(await classify(inputs), inputs)[0];
if (result.category !== 'dining' || result.country !== 'JP' || result.kind !== 'expense') throw new Error('Synthetic classification failed validation.');
console.log(`${provider === 'claude' ? 'Claude Code' : 'Codex'} application contract passed: expense / dining / JP. No bank data used.`);
