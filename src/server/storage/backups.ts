import { message as t } from "../../i18n/index.js";
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { AppError } from '../domain/ledger.js';
import { decodeLegacy, fileDigest, hasLegacyData, legacyDirectories } from './legacy-json.js';
import { DATABASE_NAME, SqliteStore } from './sqlite-store.js';
import { stateDigest } from './state-validation.js';
import { WriterLock } from './writer-lock.js';

const manifestSchema = z.object({ version: z.union([z.literal(1), z.literal(2)]), createdAt: z.string(), files: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)) });
async function snapshot(root: string, store: SqliteStore, prefix: string) {
  const createdAt = new Date().toISOString();
  const path = join(root, 'backups', `${prefix}${createdAt.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  await mkdir(path, { recursive: true, mode: 0o700 });
  await store.backupTo(join(path, DATABASE_NAME));
  const copy = SqliteStore.open(join(path, DATABASE_NAME), true);
  try { if (stateDigest(copy.load()) !== stateDigest(store.load())) throw new AppError(t("Backup verification failed."), 503); }
  finally { copy.close(); }
  // A backup is complete only once its manifest has been flushed to disk.
  await writeFile(join(path, 'manifest.json'), JSON.stringify({ version: 2, createdAt, files: { [DATABASE_NAME]: fileDigest(await readFile(join(path, DATABASE_NAME))) } }, null, 2), { flag: 'wx', mode: 0o600, flush: true });
  return path;
}
export async function createBackup(root: string) {
  const lock = new WriterLock(root); await lock.acquire();
  let store: SqliteStore | undefined;
  try { store = SqliteStore.open(join(root, DATABASE_NAME)); return await snapshot(root, store, ''); }
  finally { store?.close(); await lock.release(); }
}
export async function restoreBackup(root: string, backup: string) {
  const source = resolve(backup);
  const manifest = manifestSchema.parse(JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8')));
  const docs: Record<string, string> = {};
  if (manifest.version === 2 && (Object.keys(manifest.files).length !== 1 || !manifest.files[DATABASE_NAME])) throw new AppError(t("Invalid SQLite backup manifest."));
  for (const [file, expected] of Object.entries(manifest.files)) {
    if (manifest.version === 1 && (!legacyDirectories.some((directory) => file.startsWith(`${directory}/`)) || !/^[a-z]+\/[a-zA-Z0-9._-]+\.json$/.test(file))) throw new AppError(t("The backup contains an unsupported file path."));
    const value = await readFile(join(source, file));
    if (fileDigest(value) !== expected) throw new AppError(t("Backup checksum verification failed. Current data was not modified."));
    if (manifest.version === 1) docs[file] = value.toString('utf8');
  }
  const backupStore = manifest.version === 2 ? SqliteStore.open(join(source, DATABASE_NAME), true) : undefined;
  let restored;
  try { restored = backupStore ? backupStore.load() : decodeLegacy(docs); }
  finally { backupStore?.close(); }
  const lock = new WriterLock(root); await lock.acquire();
  let store: SqliteStore | undefined;
  try {
    const database = join(root, DATABASE_NAME);
    if (!existsSync(database)) {
      if (await hasLegacyData(root)) throw new AppError(t("Run npm run migrate:sqlite to migrate the current JSON data before restoring a backup."));
      store = await SqliteStore.create(database, restored);
      return null;
    }
    store = SqliteStore.open(database);
    const current = store.load();
    const previous = await snapshot(root, store, 'before-restore-');
    store.save(current.revision, restored);
    return previous;
  } finally { store?.close(); await lock.release(); }
}
