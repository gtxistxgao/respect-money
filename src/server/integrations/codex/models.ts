import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { codexEnvironment } from './runner.js';
import type { ModelOption } from '../../../shared/settings.js';

const pageSchema = z.object({ data: z.array(z.object({ model: z.string(), displayName: z.string(), isDefault: z.boolean() })), nextCursor: z.string().nullish() });
// Only the initialization and model catalog RPCs are sent. No thread or model turn
// is created, and no bank data or credentials enter this process.
export async function listCodexModels(bin: string, timeoutMs = 10000): Promise<ModelOption[]> {
  const directory = await mkdtemp(join(tmpdir(), 'respect-money-models-'));
  try {
    return await new Promise<ModelOption[]>((resolve, reject) => {
      const child = spawn(bin, ['app-server', '--listen', 'stdio://'], { cwd: directory, env: codexEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] });
      let result: ModelOption[] | undefined; let failure: Error | undefined;
      let buffer = ''; let bytes = 0; let requestId = 1;
      const models: ModelOption[] = []; const cursors = new Set<string>();
      const stop = (error?: Error) => { failure ||= error; child.kill('SIGKILL'); };
      const timer = setTimeout(() => stop(new Error('Model discovery timed out.')), timeoutMs);
      const send = (value: unknown) => child.stdin.write(JSON.stringify(value) + '\n');
      child.stdin.on('error', () => stop(new Error('Model discovery input closed.')));
      child.stderr.on('data', () => { /* Never forward CLI diagnostics or local configuration. */ });
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) return stop(new Error('Model discovery output exceeded the limit.'));
        buffer += chunk.toString(); const lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const message = JSON.parse(line) as { id?: number; result?: unknown; error?: unknown };
            if (message.id === undefined) continue;
            if (message.error) throw new Error('Model discovery request failed.');
            if (message.id === 0) {
              send({ method: 'initialized', params: {} });
              send({ method: 'model/list', id: requestId, params: { limit: 100, includeHidden: false } });
            } else if (message.id === requestId) {
              const page = pageSchema.parse(message.result); models.push(...page.data);
              if (page.nextCursor) {
                if (cursors.has(page.nextCursor) || cursors.size >= 20) throw new Error('Invalid model catalog pagination.');
                cursors.add(page.nextCursor);
                send({ method: 'model/list', id: ++requestId, params: { cursor: page.nextCursor, limit: 100, includeHidden: false } });
              } else { result = models; stop(); }
            }
          } catch { stop(new Error('Unable to read the model catalog.')); }
        }
      });
      child.on('error', (error) => { failure = error; });
      child.on('close', () => { clearTimeout(timer); if (failure || !result) reject(failure || new Error('Model discovery closed.')); else resolve(result); });
      send({ method: 'initialize', id: 0, params: { clientInfo: { name: 'respect_money', title: 'Respect Money', version: '0.1.0' } } });
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
