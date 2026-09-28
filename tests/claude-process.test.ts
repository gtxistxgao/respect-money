import { expect, it, vi } from 'vitest';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { claudeArguments, claudeEnvironment, runClaude } from '../src/server/integrations/claude/runner.js';
import { classificationBackend } from '../src/server/integrations/ai.js';
import { defaultSettings } from '../src/server/config.js';
import { validateClassifications, type ClassificationInput } from '../src/server/integrations/codex/classifier.js';
import { matchPatternBatch } from '../src/server/integrations/codex/pattern-matcher.js';

async function executable(body: string) {
  const directory = await mkdtemp(join(tmpdir(), 'respect-money-fake-claude-'));
  const bin = join(directory, 'cli.cjs');
  await writeFile(bin, `#!/usr/bin/env node\n${body}`, { mode: 0o700 });
  return { bin, directory, close: () => rm(directory, { recursive: true, force: true }) };
}
const success = (structured_output: unknown) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, structured_output });

it('disables tools and customizations while retaining only explicit CLI authentication variables', () => {
  vi.stubEnv('PLAID_SECRET', 'synthetic-private'); vi.stubEnv('UNRELATED_SECRET', 'synthetic-private');
  vi.stubEnv('USER', 'fixture-user'); vi.stubEnv('LOGNAME', 'fixture-user');
  vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-api-key'); vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'synthetic-token');
  try {
    const env = claudeEnvironment();
    expect(env).not.toHaveProperty('PLAID_SECRET'); expect(env).not.toHaveProperty('UNRELATED_SECRET');
    expect(env.USER).toBe('fixture-user'); expect(env.LOGNAME).toBe('fixture-user');
    expect(env.ANTHROPIC_API_KEY).toBe('synthetic-api-key'); expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('synthetic-token');
    const args = claudeArguments({ type: 'object' }, { bin: 'claude', timeoutMs: 1000 });
    for (const flag of ['--safe-mode', '--no-session-persistence', '--strict-mcp-config', '--disable-slash-commands']) expect(args).toContain(flag);
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('');
    expect(args[args.indexOf('--mcp-config') + 1]).toBe('{"mcpServers":{}}');
    expect(args).not.toContain('--bare'); expect(args).not.toContain('--dangerously-skip-permissions'); expect(args).not.toContain('--model');
  } finally { vi.unstubAllEnvs(); }
});

it('passes the prompt over stdin, extracts structured output and removes its working directory', async () => {
  const fixture = await executable(`let input = ''; process.stdin.on('data', b => input += b); process.stdin.on('end', () => {
    if (!process.env.USER || !process.env.LOGNAME) process.exit(1);
    const output = { input, cwd: process.cwd(), args: process.argv.slice(2), leaked: process.env.PLAID_SECRET || null };
    const bytes = Buffer.from(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, structured_output: output }));
    for (const byte of bytes) process.stdout.write(Buffer.from([byte]));
  });`);
  vi.stubEnv('PLAID_SECRET', 'synthetic-private'); vi.stubEnv('USER', 'fixture-user'); vi.stubEnv('LOGNAME', 'fixture-user');
  try {
    const result = await runClaude('fictional caf\u00e9 data', { type: 'object' }, { bin: fixture.bin, timeoutMs: 3000, model: 'sonnet' }) as { input: string; cwd: string; args: string[]; leaked: unknown };
    expect(result.input).toBe('fictional caf\u00e9 data'); expect(result.leaked).toBeNull();
    expect(result.args).not.toContain(result.input); expect(result.args[result.args.indexOf('--model') + 1]).toBe('sonnet');
    expect(JSON.parse(result.args[result.args.indexOf('--json-schema') + 1])).toEqual({ type: 'object' });
    expect(result.cwd).not.toBe(process.cwd()); await expect(access(result.cwd)).rejects.toThrow();
  } finally { vi.unstubAllEnvs(); await fixture.close(); }
});

it.each([
  ['nonzero exit', `console.log(${JSON.stringify(success({ ok: true }))}); process.exit(1);`, 'Claude Code failed'],
  ['error result with zero exit', `console.log(JSON.stringify({type:'result',subtype:'success',is_error:true,structured_output:{ok:true}}));`, 'Claude Code failed'],
  ['retry exhaustion', `console.log(JSON.stringify({type:'result',subtype:'error_max_structured_output_retries',is_error:false}));`, 'Claude Code failed'],
  ['malformed JSON', `console.log('not json');`, 'JSON'],
  ['missing structured output', `console.log(${JSON.stringify(success(undefined))});`, 'no structured output'],
  ['output limit', `process.stdout.write('x'.repeat(3 * 1024 * 1024)); setInterval(() => {}, 1000);`, 'size limit'],
  ['stderr limit', `process.stderr.write('x'.repeat(3 * 1024 * 1024)); setInterval(() => {}, 1000);`, 'size limit'],
])('rejects %s', async (_name, body, message) => {
  const fixture = await executable(body);
  try { await expect(runClaude('synthetic', {}, { bin: fixture.bin, timeoutMs: 3000 })).rejects.toThrow(message); }
  finally { await fixture.close(); }
});

it('handles missing executables and kills timed-out processes before cleaning up', async () => {
  const fixture = await executable(`require('node:fs').writeFileSync(__dirname + '/cwd.txt', process.cwd()); setInterval(() => {}, 1000);`);
  try {
    await expect(runClaude('synthetic', {}, { bin: join(fixture.directory, 'missing'), timeoutMs: 1000 })).rejects.toThrow('Could not start Claude Code');
    await expect(runClaude('synthetic', {}, { bin: fixture.bin, timeoutMs: 500 })).rejects.toThrow('timed out');
    await expect(access(await readFile(join(fixture.directory, 'cwd.txt'), 'utf8'))).rejects.toThrow();
  } finally { await fixture.close(); }
});

it('routes classification and pattern matching through Claude and retains shared semantic validation', async () => {
  const fixture = await executable(`let input = ''; process.stdin.on('data', b => input += b); process.stdin.on('end', () => {
    const schema = JSON.parse(process.argv[process.argv.indexOf('--json-schema') + 1]);
    const structured_output = schema.properties.classifications
      ? { classifications: [{ ref: 'r0', kind: 'expense', category: 'dining', country: 'JP', reason: 'Fixture', needsReview: false }] }
      : { reviewedCount: 1, matches: [{ ref: 'r0', reason: 'Fixture' }] };
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, structured_output }));
  });`);
  const input: ClassificationInput = { ref: 'r0', description: 'Fixture cafe', merchant: 'Fixture', postedDate: '2026-01-01', cashflowCents: -100, accountType: 'cash', source: 'manual', bankCategory: { primary: '', detailed: '' }, location: { country: 'JP', city: null, region: null }, suggestedKind: 'expense', suggestedCategory: 'uncategorized' };
  try {
    const backend = classificationBackend({ ...defaultSettings(), classificationProvider: 'claude', claudeBin: fixture.bin });
    const output = await backend.classify([input]);
    expect(validateClassifications(output, [input])[0].category).toBe('dining');
    expect(() => validateClassifications(output, [{ ...input, cashflowCents: 100 }])).toThrow('cash flow');
    expect(await matchPatternBatch(backend.matchPatterns, { example: 'Fixture cafe', category: 'dining', direction: 'outgoing' }, [input])).toEqual([{ ref: 'r0', reason: 'Fixture' }]);
  } finally { await fixture.close(); }
});
