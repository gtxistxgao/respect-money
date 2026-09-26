import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from '../src/server/config.js';

describe('local API boundary', () => {
  it('serves health and refuses cross-origin requests', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'respect-money-health-'));
    const app = await buildApp({ ...readConfig(), dataDir: directory });
    try {
      expect((await app.inject('/api/health')).json()).toEqual({ ok: true, name: 'Respect Money' });
      const foreign = await app.inject({ url: '/api/health', headers: { origin: 'https://example.com' } });
      expect(foreign.statusCode).toBe(403);
      const rebound = await app.inject({ url: '/api/health', headers: { host: 'example.com' } });
      expect(rebound.statusCode).toBe(403);
    } finally { await app.close(); await rm(directory, { recursive: true }); }
  });
});
