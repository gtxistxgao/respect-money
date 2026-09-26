import { readConfig } from '../src/server/config.js';
import { codexClassifier, validateClassifications, type ClassificationInput } from '../src/server/integrations/codex/classifier.js';

const config = readConfig();
const inputs: ClassificationInput[] = [{ ref: 'r0', description: 'Sakura Cafe, Tokyo Japan, restaurant lunch (fictional)', merchant: 'Sakura Cafe', postedDate: '2026-08-01', cashflowCents: -1250, accountType: 'credit', source: 'plaid_transactions', bankCategory: { primary: '', detailed: '' }, location: { city: 'Tokyo', country: null, region: null }, suggestedKind: 'expense', suggestedCategory: 'uncategorized' }];
const classify = codexClassifier({ bin: config.codexBin, model: config.codexModel, timeoutMs: config.codexTimeoutMs, diagnostic: console.error }, config.classificationPrompt);
const result = validateClassifications(await classify(inputs), inputs)[0];
if (result.category !== 'dining' || result.country !== 'JP' || result.kind !== 'expense') throw new Error('Synthetic classification failed validation.');
console.log('Codex application contract passed: expense / dining / JP. No bank data used.');
