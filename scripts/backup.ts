import { translateEnglish as t } from "../src/i18n/index.js";
import { readConfig } from '../src/server/config.js';
import { createBackup, restoreBackup } from '../src/server/storage/backups.js';
import { resolve } from 'node:path';

try {
  const root = readConfig().dataDir;
  if (process.argv[2] === 'restore') {
    if (!process.argv[3]) throw new Error(t("Usage: npm run restore -- data/backups/<backup-directory>"));
    const previous = await restoreBackup(root, resolve(process.argv[3]));
    console.log(previous ? t("Restore complete. Previous data saved at: {p0}", { p0: previous }) : t("Restore complete. SQLite database created."));
  } else console.log(t("Backup complete: {p0}", { p0: await createBackup(root) }));
} catch (error) { console.error(error instanceof Error ? error.message : t("Backup or restore did not complete.")); process.exitCode = 1; }
