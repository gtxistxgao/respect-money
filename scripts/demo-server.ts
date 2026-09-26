import { mkdtemp, mkdir } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { join, resolve } from 'node:path';
import { buildApp } from '../src/server/app.js';
import { defaultSettings } from '../src/server/config.js';
import { integrationPlaid, integrationClassifier, integrationPatternMatcher } from '../tests/fixtures/integration.js';

// Never load readConfig() or the owner's data directory. All figures and names
// below are invented; Plaid and AI calls use in-process test doubles.
await mkdir(resolve('data'), { recursive: true });
const dataDir = await mkdtemp(join(resolve('data'), 'demo-'));
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
try {
  app = await buildApp({ ...defaultSettings(), dataDir, port: 4191, codexBin: 'preview-codex-disabled' }, {
    plaid: integrationPlaid(), classifyBatch: integrationClassifier,
    matchPatterns: integrationPatternMatcher, models: async () => [],
  });
  async function post(url: string, payload: Record<string, unknown>) {
    const response = await app!.inject({ method: 'POST', url, payload, headers: { 'accept-language': 'en' } });
    if (response.statusCode >= 400) throw new Error(`${url}: ${response.body}`);
    return response.json();
  }
  const account = await post('/api/accounts/manual', { name: 'Sample checking', institution: 'Example Bank', type: 'cash', mask: '0001' });
  for (let month = 3; month <= 8; month++) {
    const prefix = `2026-${String(month).padStart(2, '0')}`;
    const entries = [
      ['01', 'Example company payroll', 6200 + month * 25, 'income', 'salary'],
      ['02', 'Apartment rent', 1760, 'expense', 'housing'],
      ['05', 'Neighborhood market', 420 + month * 17, 'expense', 'groceries'],
      ['08', 'Corner cafe', 85 + month * 8, 'expense', 'dining'],
      ['12', 'Weekend train tickets', 80 + month * 10, 'expense', 'travel'],
      ['15', 'Home supplies', 180 + month * 12, 'expense', 'shopping'],
      ['18', 'Internet and electricity', 165, 'expense', 'housing'],
    ];
    for (const [day, description, amount, kind, category] of entries) {
      await post('/api/transactions/manual', { accountId: account.id, postedDate: `${prefix}-${day}`, description, amount: String(amount), kind, category, country: 'US' });
    }
  }
  for (const [day, description, amount] of [['20', 'Send to Alex Morgan REF A12345', '500'], ['22', 'SEND TO ALEX MORGAN REF B98765', '525']]) {
    await post('/api/transactions/manual', { accountId: account.id, postedDate: `2026-08-${day}`, description, amount, kind: 'expense', category: 'dining', country: 'US' });
  }
  for (const asset of [
    { name: 'Sample emergency fund', kind: 'cash', valueCents: 1250000, debtCents: 0 },
    { name: 'Sample index funds', kind: 'funds', valueCents: 7500000, debtCents: 0 },
    { name: 'Sample home', kind: 'property', valueCents: 65000000, debtCents: 39000000 },
    { name: 'Sample car', kind: 'vehicle', valueCents: 2500000, debtCents: 500000, vehicleModel: 'Example family car' },
  ]) await post('/api/wealth/assets', { ...asset, valuationDate: '2026-01-01' });
  const rule = await post('/api/reclassification/rules', { example: 'Send to Alex Morgan, about $500. Ignore reference IDs.', category: 'housing', direction: 'outgoing' });
  const preview = await post(`/api/reclassification/rules/${rule.id}/preview`, {});
  for (let attempt = 0; ; attempt++) {
    const result = (await app.inject(`/api/reclassification/previews/${preview.id}`)).json();
    if (result.status === 'ready') break;
    if (result.status === 'failed' || attempt >= 50) throw new Error('Demo reclassification preview did not finish.');
    await setTimeout(100);
  }

  const address = await app.listen({ host: '127.0.0.1', port: 4191 });
  console.log(`Fictional demo: ${address}/overview?month=2026-08&period=all`);
  console.log(`Demo database: ${dataDir}/respect-money.sqlite`);
  console.log('No real bank connections or AI calls. Switch to English in Settings → Language.');
  console.log('Press Ctrl+C to stop. The ignored demo database remains available for inspection.');
  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
} finally {
  await app?.close();
}
