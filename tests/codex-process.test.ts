import { expect, it } from 'vitest';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCodex } from '../src/server/integrations/codex/runner.js';

async function executable(body: string) {
  const directory = await mkdtemp(join(tmpdir(), 'respect-money-fake-cli-'));
  const bin = join(directory, 'cli.cjs');
  await writeFile(bin, `#!/usr/bin/env node\n${body}`, { mode: 0o700 }); await chmod(bin, 0o700);
  return { bin, close: () => rm(directory, { recursive: true, force: true }) };
}
it('passes input through stdin, uses an isolated directory and excludes financial credentials from the child environment', async () => {
  const fixture = await executable(`let text = ''; process.stdin.on('data', b => text += b); process.stdin.on('end', () => { const p = process.argv[process.argv.indexOf('--output-last-message') + 1]; require('node:fs').writeFileSync(p, JSON.stringify({ input: text, cwd: process.cwd(), leaked: process.env.PLAID_SECRET || null })); });`);
  const old = process.env.PLAID_SECRET; process.env.PLAID_SECRET = 'synthetic-secret';
  try {
    const result = await runCodex('fictional data', {}, { bin: fixture.bin, timeoutMs: 3000 }) as { input: string; cwd: string; leaked: string | null };
    expect(result.input).toBe('fictional data'); expect(result.cwd).not.toBe(process.cwd()); expect(result.leaked).toBeNull();
  } finally { if (old === undefined) delete process.env.PLAID_SECRET; else process.env.PLAID_SECRET = old; await fixture.close(); }
});
it('kills a child that attempts a tool and rejects timeouts instead of publishing output', async () => {
  const tool = await executable(`process.stdout.write(JSON.stringify({ type: 'item.started', item: { type: 'command_execution' } }) + '\\n'); setInterval(() => {}, 1000);`);
  const hung = await executable('setInterval(() => {}, 1000);');
  try {
    await expect(runCodex('synthetic', {}, { bin: tool.bin, timeoutMs: 3000 })).rejects.toThrow("disallowed event");
    await expect(runCodex('synthetic', {}, { bin: hung.bin, timeoutMs: 100 })).rejects.toThrow("timed out");
  } finally { await tool.close(); await hung.close(); }
});

it('discovers paginated model catalogs without starting a turn and handles broken CLI processes', async () => {
  const { listCodexModels } = await import('../src/server/integrations/codex/models.js');
  const fixture = await executable(`require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
    const m = JSON.parse(line);
    if (m.method === 'initialized') return;
    if (!['initialize', 'model/list'].includes(m.method)) process.exit(2);
    const result = m.method === 'initialize' ? {} : { data: [{ model: m.params.cursor ? 'second' : 'first', displayName: 'Fixture', isDefault: !m.params.cursor }], nextCursor: m.params.cursor ? null : 'page-two' };
    process.stdout.write(JSON.stringify({ id: m.id, result }) + '\\n');
  });`);
  const hung = await executable('setInterval(() => {}, 1000);');
  try {
    expect((await listCodexModels(fixture.bin)).map((model) => model.model)).toEqual(['first', 'second']);
    await expect(listCodexModels(hung.bin, 100)).rejects.toThrow('timed out');
    await expect(listCodexModels(join(tmpdir(), 'nonexistent-respect-money-codex'), 100)).rejects.toThrow();
  } finally { await fixture.close(); await hung.close(); }
});
