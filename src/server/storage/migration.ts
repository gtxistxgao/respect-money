import { message as t } from "../../i18n/index.js";
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { open, rename, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { AtomicFiles } from './atomic-files.js';
import { AppError, hash, normalize, summarize } from '../domain/ledger.js';
import { decodeLegacy, fileDigest, legacyDocuments, legacySnapshot } from './legacy-json.js';
import { DATABASE_NAME, SqliteStore } from './sqlite-store.js';
import { stateCounts, stateDigest } from './state-validation.js';
import type { RepositoryState } from './state.js';

const MIGRATION_ID = 'legacy-json-v1';
function ledgerDigest(state: RepositoryState) {
  const groups = new Map<string, typeof state.processed>();
  for (const row of state.processed) { const key = `${row.accountId}:${row.postedDate.slice(0, 7)}`; groups.set(key, [...(groups.get(key) || []), row]); }
  return hash([...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, rows]) => [key, summarize(rows)]));
}
export async function migrateLegacyData(root: string) {
  // This also rolls forward any committed legacy file journal before taking a snapshot.
  const lock = new AtomicFiles(root); await lock.initialize();
  const destination = join(root, DATABASE_NAME);
  const temporary = join(root, `.migration-${randomUUID()}.sqlite`);
  let store: SqliteStore | undefined;
  try {
    if (existsSync(destination)) {
      store = SqliteStore.open(destination);
      const report = store.migration(MIGRATION_ID);
      if (!report) throw new AppError(t("The target SQLite database already exists. Migration will not overwrite it."), 409);
      store.load();
      return { alreadyMigrated: true, database: destination, report };
    }
    const docs = await legacyDocuments(root);
    const source = decodeLegacy(docs);
    const backupPath = await legacySnapshot(root, docs);
    store = await SqliteStore.create(temporary, source);
    const restored = store.load();
    const digest = stateDigest(source);
    const totalsDigest = ledgerDigest(source);
    if (stateDigest(restored) !== digest || ledgerDigest(restored) !== totalsDigest || Object.entries(source.records).some(([id, record]) => normalize(record).sourceHash !== normalize(restored.records[id]).sourceHash)) throw new AppError(t("Migration verification failed. Original data was not modified."), 503);
    store.checkIntegrity();
    const report = { version: 1, completedAt: new Date().toISOString(), backup: relative(root, backupPath), counts: stateCounts(source),
      sourceFileCount: Object.keys(docs).length, stateDigest: digest, ledgerDigest: totalsDigest,
      sourceFiles: Object.fromEntries(Object.entries(docs).map(([file, value]) => [file, fileDigest(value)])), verified: true };
    store.recordMigration(MIGRATION_ID, report);
    store.close(); store = undefined;
    const handle = await open(temporary, 'r'); try { await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, destination);
    const directory = await open(root, 'r'); try { await directory.sync(); } finally { await directory.close(); }
    return { alreadyMigrated: false, database: destination, report };
  } finally {
    store?.close();
    await rm(temporary, { force: true }); await rm(`${temporary}-journal`, { force: true });
    await lock.close();
  }
}
