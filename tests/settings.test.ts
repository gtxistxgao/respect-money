import { mkdtemp, rm, writeFile, access, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { readConfig } from '../src/server/config.js';
import { Repository } from '../src/server/storage/repository.js';
import { migrateEnvironmentSettings } from '../src/server/storage/migrate-settings.js';
import { createBackup, restoreBackup } from '../src/server/storage/backups.js';
import { classificationPrompt } from '../src/server/integrations/codex/classifier.js';
import { translate } from '../src/i18n/index.js';

it('persists UI settings, redacts secrets, preserves blank secrets and rejects conflicts and invalid input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'respect-money-settings-'));
  const config = readConfig(directory);
  let app = await buildApp(config, { models: async () => [{ model: 'fixture', displayName: 'Fixture', isDefault: true }] });
  try {
    const initial = (await app.inject('/api/settings')).json();
    expect(initial.usdCnyRate).toBe(6.7);
    expect((await app.inject('/api/wealth')).json().usdCnyRate).toBe(6.7);
    expect(initial.plaidSecret).toBeUndefined(); expect(initial.defaultPrompt).toBe(classificationPrompt);
    const saved = await app.inject({ method: 'PUT', url: '/api/settings', payload: { revision: initial.revision, plaidSecret: 'synthetic-secret', plaidClientId: 'synthetic-client', plaidEnv: 'production', usdCnyRate: 7.12, codexModel: 'fixture', classificationPrompt: 'Custom rules for classification.' } });
    expect(saved.statusCode).toBe(200); expect(saved.body).not.toContain('synthetic-secret'); expect(saved.json().hasPlaidSecret).toBe(true);
    expect((await app.inject('/api/settings/status')).json().plaidConfigured).toBe(true);
    expect((await app.inject('/api/settings/models')).json()[0].model).toBe('fixture');
    const stale = await app.inject({ method: 'PUT', url: '/api/settings', headers: { 'accept-language': 'zh' }, payload: { revision: initial.revision, codexModel: 'other' } });
    expect(stale.statusCode).toBe(409); expect(stale.json().error).toBe(translate('zh', 'Settings changed in another window. Reload settings before saving.'));
    for (const patch of [{ usdCnyRate: 0 }, { usdCnyRate: -1 }, { usdCnyRate: null }, { usdCnyRate: 1001 }, { usdCnyRate: '7.1' }, { codexTimeoutMs: 0 }, { port: 65536 }, { classificationPrompt: ' ' }, { plaidEnv: 'invalid' }, { plaidRedirectUri: 'file:///tmp' }, { codexModel: 'x\n--bad' }, { extra: 'value' }]) {
      expect((await app.inject({ method: 'PUT', url: '/api/settings', payload: { revision: 1, ...patch } })).statusCode).toBe(400);
    }
    const blank = await app.inject({ method: 'PUT', url: '/api/settings', payload: { revision: 1, plaidSecret: '' } });
    expect(blank.json().hasPlaidSecret).toBe(true);
    await app.close(); app = await buildApp(config);
    expect((await app.inject('/api/settings')).json()).toMatchObject({ usdCnyRate: 7.12, codexModel: 'fixture', classificationPrompt: 'Custom rules for classification.', hasPlaidSecret: true });
    expect(readConfig(directory).plaidSecret).toBe('synthetic-secret');
    expect((await app.inject('/api/wealth')).json().usdCnyRate).toBe(7.12);
    const removed = await app.inject({ method: 'PUT', url: '/api/settings', payload: { revision: 2, clearPlaidSecret: true } });
    expect(removed.json().hasPlaidSecret).toBe(false);
    expect((await stat(join(directory, 'respect-money.sqlite'))).mode & 0o777).toBe(0o600);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

it('migrates environment settings once, preserves financial data and includes settings in backup/restore', async () => {
  const root = await mkdtemp(join(tmpdir(), 'respect-money-settings-import-')); const data = join(root, 'data');
  const repository = await new Repository(data).initialize();
  await repository.addAccount({ name: 'Fixture Cash', institution: 'Fixture', mask: '', type: 'cash' });
  const accounts = repository.snapshot().accounts; await repository.close();
  await writeFile(join(root, '.env.local'), 'PLAID_ENV=production\nPLAID_CLIENT_ID=fixture\nPLAID_SECRET="synthetic=#secret"\nCODEX_MODEL=fixture-model\nCODEX_TIMEOUT_MS=90000\n', { mode: 0o600 });
  try {
    expect((await migrateEnvironmentSettings(root)).migrated).toBe(true);
    await expect(access(join(root, '.env.local'))).rejects.toThrow();
    expect(readConfig(data)).toMatchObject({ plaidSecret: 'synthetic=#secret', plaidEnv: 'production', codexModel: 'fixture-model', codexTimeoutMs: 90000 });
    expect((await migrateEnvironmentSettings(root)).migrated).toBe(false);
    const backup = await createBackup(data);
    const changed = await new Repository(data).initialize();
    expect(changed.snapshot().accounts).toEqual(accounts);
    await changed.change((state) => { state.settings!.codexModel = 'changed'; }, false); await changed.close();
    await restoreBackup(data, backup);
    expect(readConfig(data).codexModel).toBe('fixture-model');
    const restored = await new Repository(data).initialize(); expect(restored.snapshot().accounts).toEqual(accounts); await restored.close();
    await writeFile(join(root, '.env.local'), 'UNKNOWN_SETTING=private-value\n');
    await expect(migrateEnvironmentSettings(root)).rejects.toThrow('unsupported settings'); await access(join(root, '.env.local'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('protects connected Plaid credentials from environment/client changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'respect-money-settings-connected-'));
  const repository = await new Repository(directory).initialize();
  await repository.change((state) => { state.connections.fixture = { id: 'fixture', institution: 'Fixture', products: ['transactions'], status: 'connected' }; }, false);
  await repository.close();
  const app = await buildApp({ ...readConfig(directory), plaidClientId: 'existing-client' });
  try {
    expect((await app.inject({ method: 'PUT', url: '/api/settings', payload: { revision: 0, plaidEnv: 'production' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'PUT', url: '/api/settings', payload: { revision: 0, plaidSecret: 'rotated-secret' } })).statusCode).toBe(200);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

it('uses saved model and prompt for explicit reclassification and blocks edits during a job', async () => {
  const { readFile } = await import('node:fs/promises');
  const directory = await mkdtemp(join(tmpdir(), 'respect-money-settings-runner-'));
  const bin = join(directory, 'codex.cjs'); const log = join(directory, 'calls.jsonl');
  await writeFile(bin, `#!/usr/bin/env node
    if (process.argv.includes('--version')) { console.log('fixture-cli'); process.exit(0); }
    let prompt = ''; process.stdin.on('data', chunk => prompt += chunk);
    process.stdin.on('end', () => {
      const fs = require('node:fs');
      fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ prompt, model: process.argv[process.argv.indexOf('--model') + 1], leaked: process.env.PLAID_SECRET || null }) + '\\n');
      const inputs = JSON.parse(prompt.split('Transaction data (JSON):\\n').pop());
      setTimeout(() => fs.writeFileSync(process.argv[process.argv.indexOf('--output-last-message') + 1], JSON.stringify({ classifications: inputs.map(input => ({ ref: input.ref, kind: 'expense', category: 'dining', country: 'US', reason: 'Fixture', needsReview: false })) })), 150);
    });`, { mode: 0o700 });
  const repository = await new Repository(directory).initialize();
  const account = await repository.addAccount({ name: 'Fixture', institution: 'Fixture', type: 'cash', mask: '' });
  await repository.addManual({ accountId: account.id, postedDate: '2026-01-05', description: 'Fixture cafe', amount: '10', kind: 'expense', category: 'uncategorized', country: 'US', notes: '' });
  await repository.close();
  const app = await buildApp({ ...readConfig(directory), codexBin: bin });
  const save = (revision: number, classificationPrompt: string) => app.inject({ method: 'PUT', url: '/api/settings', payload: { revision, classificationPrompt, codexModel: 'fixture-model', plaidSecret: 'synthetic-runtime-secret' } });
  const run = async (force = false) => {
    const response = await app.inject({ method: 'POST', url: '/api/jobs', payload: { type: 'classify', range: { start: '2026-01-01', end: '2026-01-31' }, accountIds: [account.id], force } });
    expect(response.statusCode).toBe(202); return response.json().id as string;
  };
  const finish = async (id: string) => {
    await expect.poll(async () => (await app.inject('/api/jobs')).json().find((job: { id: string }) => job.id === id)?.status).toBe('succeeded');
  };
  try {
    expect((await save(0, 'First custom rules.')).statusCode).toBe(200);
    const first = await run(); expect((await save(1, 'Cannot change a running task.')).statusCode).toBe(409); await finish(first);
    await finish(await run());
    expect((await readFile(log, 'utf8')).trim().split('\n')).toHaveLength(1);
    expect((await save(1, 'Second custom rules.')).statusCode).toBe(200); await finish(await run());
    expect((await readFile(log, 'utf8')).trim().split('\n')).toHaveLength(1);
    await finish(await run(true));
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(calls).toHaveLength(2);
    expect(calls[0].prompt).toContain('First custom rules.'); expect(calls[1].prompt).toContain('Second custom rules.');
    expect(calls.every((call) => call.model === 'fixture-model' && call.leaked === null)).toBe(true);
    expect(JSON.stringify(calls)).not.toContain('synthetic-runtime-secret');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

it('allows configuring an old ledger with no settings and imports over untouched startup defaults', async () => {
  const root = await mkdtemp(join(tmpdir(), 'respect-money-settings-default-')); const directory = join(root, 'data');
  const repository = await new Repository(directory).initialize();
  await repository.change((state) => { state.connections.fixture = { id: 'fixture', institution: 'Fixture', products: ['transactions'], status: 'connected' }; }, false);
  await repository.close();
  let app = await buildApp(readConfig(directory));
  try {
    await app.close();
    await writeFile(join(root, '.env.local'), 'PLAID_ENV=production\nPLAID_CLIENT_ID=fixture-client\nPLAID_SECRET=fixture-secret\n');
    expect((await migrateEnvironmentSettings(root)).migrated).toBe(true);
    expect(readConfig(directory).plaidClientId).toBe('fixture-client');
    const old = await new Repository(directory).initialize();
    await old.change((state) => { delete state.settings; }, false); await old.close();
    app = await buildApp(readConfig(directory));
    expect((await app.inject({ method: 'PUT', url: '/api/settings', payload: { revision: 0, plaidEnv: 'production', plaidClientId: 'fixture-client', plaidSecret: 'fixture-secret' } })).statusCode).toBe(200);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});
