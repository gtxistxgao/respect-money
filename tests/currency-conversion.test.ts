import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { readConfig } from '../src/server/config.js';
import { createBackup, restoreBackup } from '../src/server/storage/backups.js';
import { resolveDisplayConversion } from '../src/shared/settings.js';
import { convertedAmount } from '../src/web/features/wealth/conversion.js';

it('keeps legacy CNY settings and persists normalized currency, rate and disabled state through restart and backup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'respect-money-currency-'));
  let app = await buildApp({ ...readConfig(directory), codexBin: 'fixture-missing-cli', usdCnyRate: 7.12 });
  try {
    expect((await app.inject('/api/settings')).json().displayConversion).toEqual({ enabled: true, currency: 'CNY', rate: 7.12 });
    const before = (await app.inject('/api/wealth')).json();
    expect(before.displayConversion).toEqual({ enabled: true, currency: 'CNY', rate: 7.12 });
    const saved = await app.inject({ method: 'PUT', url: '/api/settings', payload: { revision: 0, displayConversion: { enabled: true, currency: ' cad ', rate: 1.4 } } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().displayConversion).toEqual({ enabled: true, currency: 'CAD', rate: 1.4 });
    const disabled = { enabled: false, currency: 'CAD', rate: 1.4 };
    expect((await app.inject({ method: 'PUT', url: '/api/settings', payload: { revision: 1, displayConversion: disabled } })).statusCode).toBe(200);
    await app.close();
    const backup = await createBackup(directory);
    app = await buildApp(readConfig(directory));
    expect((await app.inject('/api/settings')).json().displayConversion).toEqual(disabled);
    expect((await app.inject('/api/wealth')).json()).toMatchObject({ displayConversion: disabled, assetsCents: before.assetsCents, debtsCents: before.debtsCents, netWorthCents: before.netWorthCents });
    expect((await app.inject({ method: 'PUT', url: '/api/settings', payload: { revision: 2, displayConversion: { enabled: true, currency: 'JPY', rate: 1500 } } })).statusCode).toBe(200);
    await app.close(); await restoreBackup(directory, backup); app = await buildApp(readConfig(directory));
    expect((await app.inject('/api/settings')).json().displayConversion).toEqual(disabled);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

it('rejects invalid currency codes and nonpositive or nonnumeric exchange rates without changing settings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'respect-money-currency-validation-'));
  const app = await buildApp({ ...readConfig(directory), codexBin: 'fixture-missing-cli' });
  try {
    const initial = (await app.inject('/api/settings')).json();
    for (const patch of [{ currency: '' }, { currency: 'CA' }, { currency: 'CADX' }, { currency: '$$$' }, { currency: 'C1Y' }, { rate: 0 }, { rate: -1 }, { rate: '1.4' }, { rate: null }, { enabled: 'false' }]) {
      expect((await app.inject({ method: 'PUT', url: '/api/settings', payload: { revision: initial.revision, displayConversion: { enabled: true, currency: 'CAD', rate: 1.4, ...patch } } })).statusCode).toBe(400);
    }
    expect((await app.inject('/api/settings')).json()).toEqual(initial);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

it('formats other currencies without the CNY ten-thousand unit and resolves legacy snapshots', () => {
  expect(resolveDisplayConversion({ usdCnyRate: 7 })).toEqual({ enabled: true, currency: 'CNY', rate: 7 });
  const cad = { enabled: true, currency: 'CAD', rate: 1.4 };
  expect(convertedAmount(100000, cad)).toContain('1,400 CAD');
  expect(convertedAmount(-100000, cad)).toContain('-1,400 CAD');
  expect(convertedAmount(0, cad)).toContain('0 CAD');
  expect(convertedAmount(100000, cad)).not.toContain('10,000');
});
