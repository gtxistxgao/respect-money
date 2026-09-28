import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { readConfig, defaultSettings } from '../src/server/config.js';
import { Repository } from '../src/server/storage/repository.js';
import { applicationSettingsSchema } from '../src/shared/settings.js';

it('reads legacy settings as Codex and validates independent provider settings without resetting selection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'respect-money-legacy-ai-'));
  const repository = await new Repository(directory).initialize();
  const legacy = { ...defaultSettings(), codexBin: 'fixture-missing-codex' };
  delete legacy.classificationProvider; delete legacy.claudeBin; delete legacy.claudeModel; delete legacy.claudeTimeoutMs;
  expect(applicationSettingsSchema.parse(legacy)).toEqual(legacy);
  await repository.change(state => { state.settings = legacy; }, false); await repository.close();
  let app = await buildApp(readConfig(directory));
  try {
    const initial = (await app.inject('/api/settings')).json();
    expect(initial).toMatchObject({ classificationProvider: 'codex', claudeBin: 'claude', claudeModel: '', claudeTimeoutMs: 120000 });
    for (const patch of [{ classificationProvider: 'invalid' }, { claudeTimeoutMs: 0 }, { claudeBin: '' }, { claudeModel: 'x\n--bad' }]) {
      expect((await app.inject({ method: 'PUT', url: '/api/settings', payload: { revision: 0, ...patch } })).statusCode).toBe(400);
    }
    expect((await app.inject('/api/settings/models?provider=claude')).json().map((row: { model: string }) => row.model)).toEqual(['sonnet', 'opus', 'haiku']);
    expect((await app.inject('/api/settings/models?provider=invalid')).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/settings', payload: { revision: 0, classificationProvider: 'claude', claudeModel: 'sonnet', claudeBin: 'fixture-missing-claude', claudeTimeoutMs: 90000 } })).statusCode).toBe(200);
    // Saving an unrelated field must not revert the selected backend.
    expect((await app.inject({ method: 'PUT', url: '/api/settings', payload: { revision: 1, codexModel: 'fixture-codex' } })).json().classificationProvider).toBe('claude');
    await app.close(); app = await buildApp(readConfig(directory));
    expect((await app.inject('/api/settings')).json()).toMatchObject({ classificationProvider: 'claude', claudeModel: 'sonnet', codexModel: 'fixture-codex', claudeTimeoutMs: 90000 });
    expect((await app.inject('/api/settings/status')).json()).toMatchObject({ classificationProvider: 'claude', cliVersion: null, codexVersion: null });
    expect((await app.inject('/api/settings/models')).json()).toHaveLength(3);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

it('switches providers for future jobs and scans while preserving historical attribution across restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'respect-money-ai-switch-'));
  const bin = join(directory, 'cli.cjs');
  await writeFile(bin, `#!/usr/bin/env node
    if (process.argv.includes('--version')) { console.log('fixture-cli'); process.exit(0); }
    const claude = process.argv.includes('--print');
    let prompt = ''; process.stdin.on('data', b => prompt += b); process.stdin.on('end', () => {
      const model = process.argv[process.argv.indexOf('--model') + 1];
      if (model !== (claude ? 'sonnet' : 'fixture-codex')) process.exit(2);
      let output;
      if (prompt.includes('Transaction data (JSON):')) {
        const rows = JSON.parse(prompt.split('Transaction data (JSON):\\n').pop());
        output = { classifications: rows.map(row => ({ ref: row.ref, kind: 'expense', category: 'dining', country: 'US', needsReview: false, reason: claude ? 'Claude fixture' : 'Codex fixture' })) };
      } else {
        if (!claude) process.exit(3);
        const data = JSON.parse(prompt.split('\\n').pop());
        output = { reviewedCount: data.transactions.length, matches: data.transactions.map(row => ({ ref: row.ref, reason: 'Pattern fixture' })) };
      }
      if (claude) console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,structured_output:output}));
      else require('node:fs').writeFileSync(process.argv[process.argv.indexOf('--output-last-message') + 1], JSON.stringify(output));
    });`, { mode: 0o700 });
  const repository = await new Repository(directory).initialize();
  const account = await repository.addAccount({ name: 'Fixture', institution: 'Fixture', type: 'cash', mask: '' });
  await repository.addManual({ accountId: account.id, postedDate: '2026-01-05', description: 'Fictional cafe', amount: '10', kind: 'expense', category: 'uncategorized', country: 'US', notes: '' });
  await repository.close();
  let app = await buildApp({ ...readConfig(directory), codexBin: bin, codexModel: 'fixture-codex', claudeBin: bin, claudeModel: 'sonnet' });
  const run = async (force = false) => {
    const response = await app.inject({ method: 'POST', url: '/api/jobs', payload: { type: 'classify', range: { start: '2026-01-01', end: '2026-01-31' }, accountIds: [account.id], force } });
    expect(response.statusCode).toBe(202);
    await expect.poll(async () => (await app.inject('/api/jobs')).json().find((job: { id: string }) => job.id === response.json().id)?.status).toBe('succeeded');
  };
  const source = async () => {
    await app.close();
    const saved = await new Repository(directory).initialize();
    try { return saved.snapshot().processed[0].classificationSource; }
    finally { await saved.close(); app = await buildApp(readConfig(directory)); }
  };
  try {
    await run(); expect(await source()).toBe('codex');
    expect((await app.inject({ method: 'PUT', url: '/api/settings', payload: { revision: 0, classificationProvider: 'claude' } })).statusCode).toBe(200);
    expect((await app.inject('/api/settings/status')).json()).toMatchObject({ classificationProvider: 'claude', cliVersion: 'fixture-cli', codexVersion: null });
    await run(); expect(await source()).toBe('codex');
    await run(true); expect(await source()).toBe('claude');
    const rule = (await app.inject({ method: 'POST', url: '/api/reclassification/rules', payload: { example: 'Fictional cafe', direction: 'outgoing', category: 'shopping' } })).json();
    const scan = (await app.inject({ method: 'POST', url: `/api/reclassification/rules/${rule.id}/preview` })).json();
    await expect.poll(async () => (await app.inject(`/api/reclassification/previews/${scan.id}`)).json().status).toBe('ready');
    const preview = (await app.inject(`/api/reclassification/previews/${scan.id}`)).json();
    expect(preview.matches).toHaveLength(1); expect(preview.matches[0].classificationSource).toBe('claude');
    expect((await app.inject({ method: 'PUT', url: '/api/settings', payload: { revision: 1, classificationProvider: 'codex' } })).statusCode).toBe(200);
    expect(await source()).toBe('claude');
    await run(true); expect(await source()).toBe('codex');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
