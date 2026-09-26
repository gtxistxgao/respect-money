import { message as t, LocalizedError } from "../../../i18n/index.js";
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type CodexOptions = { bin: string; model?: string; timeoutMs: number; diagnostic?: (message: string) => void };

const disabledFeatures = [
  'shell_tool', 'unified_exec', 'apps', 'plugins', 'hooks', 'multi_agent',
  'browser_use', 'browser_use_external', 'in_app_browser', 'computer_use',
  'image_generation', 'view_image', 'skill_mcp_dependency_install', 'memories',
  'shell_snapshot', 'code_mode_host', 'sleep_tool', 'goals', 'artifact',
  'workspace_dependencies', 'skill_search',
];

export function codexArguments(directory: string, options: CodexOptions) {
  return [
    'exec', '--ignore-user-config', '--ignore-rules', '--ephemeral',
    '--skip-git-repo-check', '--sandbox', 'read-only', '--cd', directory,
    '-c', 'project_doc_max_bytes=0', '-c', 'web_search="disabled"',
    '-c', 'history.persistence="none"', '-c', 'approval_policy="never"',
    ...disabledFeatures.flatMap((feature) => ['--disable', feature]),
    '--enable', 'skip_host_skill_discovery',
    ...(options.model ? ['--model', options.model] : []),
    '--output-schema', join(directory, 'schema.json'),
    '--output-last-message', join(directory, 'result.json'),
    '--json', '--color', 'never', '-',
  ];
}

export function codexEnvironment() {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'CODEX_HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SSL_CERT_FILE', 'SSL_CERT_DIR']) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  return environment;
}

export async function runCodex(prompt: string, schema: object, options: CodexOptions): Promise<unknown> {
  const directory = await mkdtemp(join(tmpdir(), 'respect-money-classify-'));
  try {
    await writeFile(join(directory, 'schema.json'), JSON.stringify(schema), { mode: 0o600 });
    await new Promise<void>((resolve, reject) => {
      const child = spawn(options.bin, codexArguments(directory, options), {
        cwd: directory, env: codexEnvironment(), stdio: ['pipe', 'pipe', 'pipe'],
      });
      let failure: Error | undefined;
      let bytes = 0;
      let buffered = '';
      const fail = (message: string) => {
        failure ??= new LocalizedError(message);
        child.kill('SIGKILL');
      };
      const timeout = setTimeout(() => fail(t("Codex classification timed out. Retry or select a smaller date range.")), options.timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) return fail(t("Codex output exceeded the size limit."));
        buffered += chunk.toString();
        const lines = buffered.split('\n');
        buffered = lines.pop() || '';
        for (const line of lines) {
          try {
            const event = JSON.parse(line) as { type?: string; message?: string; item?: { type?: string; message?: string } };
            if (event.item?.type === 'error') {
              options.diagnostic?.(JSON.stringify(event));
              continue;
            }
            if (event.item?.type && !['agent_message', 'reasoning'].includes(event.item.type)) {
              fail(t("Classification stopped after a disallowed event ({p0}).", { p0: event.item.type }));
            }
            if (event.type === 'turn.failed' || event.type === 'error') {
              options.diagnostic?.(JSON.stringify(event));
              fail(t("Codex failed. Check your local login and model configuration."));
            }
          } catch { /* Non-JSON diagnostic lines are not persisted. */ }
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        options.diagnostic?.(chunk.toString());
        if (bytes > 2 * 1024 * 1024) fail(t("Codex output exceeded the size limit."));
      });
      child.on('error', () => { clearTimeout(timeout); reject(new LocalizedError(t("Could not start Codex. Check CODEX_BIN and the local installation."))); });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (failure) reject(failure);
        else if (code !== 0) reject(new LocalizedError(t("Codex failed. Check your local login and model configuration.")));
        else resolve();
      });
      child.stdin.on('error', () => { /* Process exit is handled above. */ });
      child.stdin.end(prompt);
    });
    const result = await readFile(join(directory, 'result.json'), 'utf8');
    if (result.length > 1024 * 1024) throw new LocalizedError(t("Codex classification results exceeded the size limit."));
    return JSON.parse(result) as unknown;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
