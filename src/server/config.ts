import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { applicationSettingsSchema, type ApplicationSettings } from '../shared/settings.js';
import { classificationPrompt } from './integrations/codex/classifier.js';

export function defaultSettings(): ApplicationSettings {
  return { revision: 0, port: 3001, plaidEnv: 'sandbox', plaidClientId: '', plaidSecret: '',
    plaidRedirectUri: '', classificationProvider: 'codex', claudeBin: 'claude', claudeModel: '', claudeTimeoutMs: 120000, codexBin: 'codex', codexModel: '', codexTimeoutMs: 120000, classificationPrompt };
}
// Application configuration lives alongside the ledger in SQLite. OS environment
// variables are used only by subprocesses for executable discovery and CLI login.
export function readConfig(dataDir = resolve('data')) {
  const path = join(dataDir, 'respect-money.sqlite');
  let settings = defaultSettings();
  if (existsSync(path)) {
    const db = new DatabaseSync(path, { readOnly: true, timeout: 5000 });
    try {
      const row = db.prepare("SELECT json_extract(data, '$.settings') AS settings FROM app_metadata WHERE id = 'state'").get();
      if (row?.settings) settings = applicationSettingsSchema.parse(JSON.parse(String(row.settings)));
    } finally { db.close(); }
  }
  return { ...settings, dataDir: resolve(dataDir) };
}
export type AppConfig = ReturnType<typeof readConfig>;
