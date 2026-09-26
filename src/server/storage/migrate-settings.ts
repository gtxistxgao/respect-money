import { existsSync } from 'node:fs';
import { readFile, unlink, mkdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { resolve, join } from 'node:path';
import { defaultSettings, readConfig } from '../config.js';
import { applicationSettingsSchema } from '../../shared/settings.js';
import { stateDigest } from './state-validation.js';
import { Repository } from './repository.js';
import { createBackup } from './backups.js';
import { DATABASE_NAME, SqliteStore } from './sqlite-store.js';
import { hasLegacyData } from './legacy-json.js';
import { WriterLock } from './writer-lock.js';

// Explicit, one-time import only. Application startup never reads environment files.
export async function migrateEnvironmentSettings(root: string) {
  const files = ['.env', '.env.local'].map((file) => join(root, file)).filter(existsSync);
  if (!files.length) return { migrated: false, removedFiles: 0 };
  const values: Record<string, string> = {};
  for (const file of files) Object.assign(values, parseEnv(await readFile(file, 'utf8')));
  const supported = ['PORT', 'PLAID_ENV', 'PLAID_CLIENT_ID', 'PLAID_SECRET', 'PLAID_REDIRECT_URI', 'CODEX_BIN', 'CODEX_MODEL', 'CODEX_TIMEOUT_MS', 'RESPECT_MONEY_DATA_DIR'];
  if (Object.keys(values).some((key) => !supported.includes(key))) throw new Error('The environment file contains unsupported settings. It was preserved for review.');
  const settings = applicationSettingsSchema.parse({ ...defaultSettings(),
    port: Number(values.PORT || 3001), plaidEnv: values.PLAID_ENV || 'sandbox', plaidClientId: values.PLAID_CLIENT_ID || '', plaidSecret: values.PLAID_SECRET || '',
    plaidRedirectUri: values.PLAID_REDIRECT_URI || '', codexBin: values.CODEX_BIN || 'codex', codexModel: values.CODEX_MODEL || '', codexTimeoutMs: Number(values.CODEX_TIMEOUT_MS || 120000),
  });
  const destination = resolve(root, 'data');
  const source = resolve(root, values.RESPECT_MONEY_DATA_DIR || (settings.plaidEnv === 'sandbox' ? 'data/sandbox' : 'data'));
  if (!existsSync(join(source, DATABASE_NAME)) && await hasLegacyData(source)) throw new Error('Migrate the legacy JSON ledger before importing environment settings.');
  // Consolidate a legacy sandbox/custom data directory without mixing ledgers.
  if (source !== destination && existsSync(join(source, DATABASE_NAME))) {
    if (existsSync(join(destination, DATABASE_NAME))) throw new Error('Both legacy and destination databases exist. They were preserved; select the ledger to migrate before continuing.');
    const lock = new WriterLock(source); await lock.acquire();
    let store: SqliteStore | undefined;
    try {
      await mkdir(destination, { recursive: true, mode: 0o700 });
      store = SqliteStore.open(join(source, DATABASE_NAME), true);
      await store.backupTo(join(destination, DATABASE_NAME));
    } finally { store?.close(); await lock.release(); }
  }
  const backup = existsSync(join(destination, DATABASE_NAME)) ? await createBackup(destination) : undefined;
  const repository = await new Repository(destination).initialize();
  try {
    const existing = repository.snapshot().settings;
    if (existing && JSON.stringify(existing) !== JSON.stringify(defaultSettings()) && JSON.stringify(existing) !== JSON.stringify(settings)) throw new Error('SQLite settings already exist. Existing settings and environment files were preserved.');
    const before = repository.snapshot();
    if (JSON.stringify(existing) !== JSON.stringify(settings)) await repository.change((state) => { state.settings = settings; }, false);
    const after = repository.snapshot();
    delete before.settings; delete after.settings; after.revision = before.revision;
    if (stateDigest(before) !== stateDigest(after)) throw new Error('Ledger verification failed. Environment files were preserved.');
  } finally { await repository.close(); }
  const { dataDir: _dataDir, ...verified } = readConfig(destination); void _dataDir;
  if (JSON.stringify(verified) !== JSON.stringify(settings)) throw new Error('Settings verification failed. Environment files were preserved.');
  for (const file of files) await unlink(file);
  return { migrated: true, removedFiles: files.length, backup };
}
