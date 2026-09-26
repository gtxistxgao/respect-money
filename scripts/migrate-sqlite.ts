import { translateEnglish as t } from "../src/i18n/index.js";
import { readConfig } from '../src/server/config.js';
import { migrateLegacyData } from '../src/server/storage/migration.js';

try {
  const result = await migrateLegacyData(readConfig().dataDir);
  const report = result.report as { counts: unknown; backup: string; verified: boolean };
  console.log(JSON.stringify({ database: result.database, alreadyMigrated: result.alreadyMigrated, backup: report.backup, counts: report.counts, verified: report.verified }, null, 2));
} catch (error) { console.error(error instanceof Error ? error.message : t("SQLite migration did not complete.")); process.exitCode = 1; }
