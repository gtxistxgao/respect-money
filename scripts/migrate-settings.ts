import { migrateEnvironmentSettings } from '../src/server/storage/migrate-settings.js';

try {
  const result = await migrateEnvironmentSettings(process.cwd());
  console.log(result.migrated ? `Settings migrated to local SQLite; removed ${result.removedFiles} legacy environment file(s).` : 'No legacy environment files found. Configure the application in Settings.');
  if (result.backup) console.log(`Ledger backup: ${result.backup}`);
} catch {
  // Parser errors may contain sensitive input. Never print them or credentials.
  console.error('Settings migration could not complete. Stop the application, check for existing SQLite settings or conflicting data directories, and retry. Unmigrated environment files were preserved.');
  process.exitCode = 1;
}
