import { message as t } from "../../i18n/index.js";
import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { chmod, open, rm } from 'node:fs/promises';
import { AppError } from '../domain/ledger.js';
import { emptyState, type RepositoryState } from './state.js';
import { validateState } from './state-validation.js';

export const DATABASE_NAME = 'respect-money.sqlite';
const APPLICATION_ID = 0x524d4e59;
const tables = ['app_metadata', 'accounts', 'connections', 'account_ranges', 'jobs', 'stale_accounts', 'raw_records', 'transaction_overrides', 'classifications', 'processed_transactions', 'plaid_tokens', 'link_sessions'] as const;
type Table = typeof tables[number];
type Document = { position: number; data: string };
type Documents = Record<Table, Map<string, Document>>;
const jsonColumn = (name: string, path: string, type = 'TEXT') => `, ${name} ${type} GENERATED ALWAYS AS (json_extract(data, '${path}')) STORED`;
const extraColumns: Partial<Record<Table, string>> = {
  app_metadata: jsonColumn('revision', '$.revision', 'INTEGER'),
  accounts: jsonColumn('name', '$.name') + jsonColumn('institution', '$.institution') + jsonColumn('enabled', '$.enabled', 'INTEGER'),
  connections: jsonColumn('cursor', '$.cursor') + jsonColumn('status', '$.status'),
  jobs: jsonColumn('status', '$.status'),
  raw_records: jsonColumn('account_id', '$.accountId') + jsonColumn('source', '$.source') + `, posted_date TEXT GENERATED ALWAYS AS (coalesce(json_extract(data, '$.payload.postedDate'), json_extract(data, '$.payload.date'))) STORED, FOREIGN KEY (account_id) REFERENCES accounts(id) DEFERRABLE INITIALLY DEFERRED`,
  transaction_overrides: jsonColumn('revision', '$.revision', 'INTEGER'),
  classifications: jsonColumn('source_hash', '$.sourceHash') + jsonColumn('classifier_version', '$.classifierVersion'),
  processed_transactions: jsonColumn('account_id', '$.accountId') + jsonColumn('parent_id', '$.parentId') + jsonColumn('posted_date', '$.postedDate') + jsonColumn('cashflow_cents', '$.cashflowCents', 'INTEGER') + jsonColumn('kind', '$.kind') + jsonColumn('category', '$.category') + jsonColumn('currency', '$.currency') + jsonColumn('excluded', '$.excluded', 'INTEGER') + jsonColumn('needs_review', '$.needsReview', 'INTEGER') + ', FOREIGN KEY (account_id) REFERENCES accounts(id) DEFERRABLE INITIALLY DEFERRED',
};

function documents(state: RepositoryState): Documents {
  const result = Object.fromEntries(tables.map((table) => [table, new Map<string, Document>()])) as Documents;
  const add = (table: Table, entries: [string, unknown][]) => entries.forEach(([id, value], position) => result[table].set(id, { position, data: JSON.stringify(value) }));
  add('app_metadata', [['state', { schemaVersion: state.schemaVersion, revision: state.revision, userId: state.vault.userId, ...(state.wealth ? { wealth: state.wealth } : {}), ...(state.settings ? { settings: state.settings } : {}), ...(state.reclassificationRules ? { reclassificationRules: state.reclassificationRules } : {}) }]]);
  add('accounts', state.accounts.map((account) => [account.id, account]));
  add('connections', Object.entries(state.connections)); add('account_ranges', Object.entries(state.ranges)); add('jobs', Object.entries(state.jobs));
  add('stale_accounts', state.staleAccountIds.map((id, index) => [String(index), id]));
  add('raw_records', Object.entries(state.records)); add('transaction_overrides', Object.entries(state.overrides));
  add('classifications', Object.entries(state.classifications)); add('processed_transactions', state.processed.map((row) => [row.id, row]));
  add('plaid_tokens', Object.entries(state.vault.tokens)); add('link_sessions', Object.entries(state.vault.links));
  return result;
}

export class SqliteStore {
  private cached?: Documents;
  private constructor(private readonly db: DatabaseSync, readonly path: string) {}
  static async create(path: string, initial = emptyState()) {
    const handle = await open(path, 'wx', 0o600); await handle.close();
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(path, { timeout: 5000 });
      db.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; BEGIN IMMEDIATE;');
      for (const table of tables) db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, position INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data))${extraColumns[table] || ''}) STRICT;`);
      db.exec(`CREATE TABLE migrations (id TEXT PRIMARY KEY, report_json TEXT NOT NULL CHECK(json_valid(report_json))) STRICT;
        CREATE INDEX raw_account_date ON raw_records(account_id, posted_date);
        CREATE INDEX processed_account_date ON processed_transactions(account_id, posted_date);
        CREATE INDEX processed_category ON processed_transactions(category, posted_date);
        CREATE INDEX processed_parent ON processed_transactions(parent_id);
        PRAGMA application_id = ${APPLICATION_ID}; PRAGMA user_version = 1; COMMIT;`);
      const store = new SqliteStore(db, path); store.save(undefined, initial); return store;
    } catch (error) {
      if (db?.isOpen) db.close();
      await rm(path, { force: true }); await rm(`${path}-journal`, { force: true });
      throw error;
    }
  }
  static open(path: string, readOnly = false) {
    if (!existsSync(path)) throw new AppError(t("SQLite database not found. Migrate data or start the application first."), 503);
    const db = new DatabaseSync(path, { readOnly, timeout: 5000 });
    try {
      if (db.prepare('PRAGMA application_id').get()?.application_id !== APPLICATION_ID || db.prepare('PRAGMA user_version').get()?.user_version !== 1) throw new AppError(t("Unsupported SQLite database format or version. Check the data directory."), 503);
      db.exec('PRAGMA foreign_keys = ON;');
      if (!readOnly) db.exec('PRAGMA synchronous = FULL;');
      const store = new SqliteStore(db, path); store.checkIntegrity(); return store;
    } catch (error) { db.close(); throw error; }
  }
  checkIntegrity() {
    const checks = this.db.prepare('PRAGMA integrity_check').all();
    if (checks.length !== 1 || checks[0].integrity_check !== 'ok' || this.db.prepare('PRAGMA foreign_key_check').all().length) throw new AppError(t("SQLite integrity verification failed. Restore from a backup."), 503);
  }
  load(): RepositoryState {
    const loaded = Object.fromEntries(tables.map((table) => [table, this.db.prepare(`SELECT id, position, data FROM ${table} ORDER BY position, id`).all()])) as Record<Table, { id: string; position: number; data: string }[]>;
    const map = (table: Table) => Object.fromEntries(loaded[table].map((row) => [row.id, JSON.parse(row.data) as unknown]));
    const values = (table: Table) => loaded[table].map((row) => JSON.parse(row.data) as unknown);
    if (loaded.app_metadata.length !== 1 || loaded.app_metadata[0].id !== 'state') throw new AppError(t("The SQLite database is missing ledger metadata."), 503);
    const meta = JSON.parse(loaded.app_metadata[0].data) as { schemaVersion: 1; revision: number; userId: string; wealth?: RepositoryState['wealth']; settings?: RepositoryState['settings']; reclassificationRules?: RepositoryState['reclassificationRules'] };
    const state = { ...(meta.wealth ? { wealth: meta.wealth } : {}), ...(meta.settings ? { settings: meta.settings } : {}), ...(meta.reclassificationRules ? { reclassificationRules: meta.reclassificationRules } : {}), schemaVersion: meta.schemaVersion, revision: meta.revision, accounts: values('accounts'), connections: map('connections'), ranges: map('account_ranges'),
      jobs: map('jobs'), staleAccountIds: values('stale_accounts'), records: map('raw_records'), overrides: map('transaction_overrides'), classifications: map('classifications'),
      processed: values('processed_transactions'), vault: { userId: meta.userId, tokens: map('plaid_tokens'), links: map('link_sessions') } } as RepositoryState;
    validateState(state);
    this.cached = Object.fromEntries(tables.map((table) => [table, new Map(loaded[table].map((row) => [row.id, { position: row.position, data: row.data }]))])) as Documents;
    return state;
  }
  save(previousRevision: number | undefined, state: RepositoryState) {
    validateState(state);
    const next = documents(state);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const currentRevision = this.db.prepare("SELECT revision FROM app_metadata WHERE id = 'state'").get()?.revision;
      if (currentRevision !== previousRevision) throw new AppError(t("Another writer modified the database. Restart the application and try again."), 409);
      for (const table of tables) {
        const current = this.cached?.[table] ?? new Map(this.db.prepare(`SELECT id, position, data FROM ${table}`).all().map((row) => [String(row.id), { position: Number(row.position), data: String(row.data) }]));
        const remove = this.db.prepare(`DELETE FROM ${table} WHERE id = ?`);
        for (const id of current.keys()) if (!next[table].has(id)) remove.run(id);
        const upsert = this.db.prepare(`INSERT INTO ${table} (id, position, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET position = excluded.position, data = excluded.data`);
        for (const [id, doc] of next[table]) {
          const old = current.get(id);
          if (!old || old.data !== doc.data || old.position !== doc.position) upsert.run(id, doc.position, doc.data);
        }
      }
      this.db.exec('COMMIT'); this.cached = next;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
  migration(id: string): unknown {
    const row = this.db.prepare('SELECT report_json FROM migrations WHERE id = ?').get(id);
    return row ? JSON.parse(String(row.report_json)) as unknown : undefined;
  }
  recordMigration(id: string, report: unknown) { this.db.prepare('INSERT INTO migrations (id, report_json) VALUES (?, ?)').run(id, JSON.stringify(report)); }
  async backupTo(path: string) {
    const handle = await open(path, 'wx', 0o600); await handle.close();
    try { await backup(this.db, path); await chmod(path, 0o600); }
    catch (error) { await rm(path, { force: true }); throw error; }
  }
  close() { if (this.db.isOpen) this.db.close(); }
}
