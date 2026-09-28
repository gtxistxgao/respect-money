# SQLite storage

The active database is `data/respect-money.sqlite`. The whole `data/` directory is ignored by Git. Node.js 24+ supplies SQLite without an external database service. Normal startup reads settings from SQLite; only the explicit `migrate:settings` importer reads legacy environment files.

## Tables and documents

Each entity is a row with a stable ID, ordering `position`, and complete JSON `data`. Collections have separate tables; generated SQL columns and indexes support account/date, category/date, and parent-transaction lookups. Complete documents retain optional fields, unknown provider fields, and nested content.

| State | Table | Key and content |
| --- | --- | --- |
| Metadata | `app_metadata` | One `state` row: schema/revision, local user ID, optional settings, rules, wealth/history |
| Accounts | `accounts` | Local account ID and full account document |
| Connections | `connections` | Connection ID, product/state information, sync cursor |
| Enabled ranges | `account_ranges` | Account ID and range array, including empty arrays |
| Jobs | `jobs` | Job ID and durable progress/status |
| Stale accounts | `stale_accounts` | Array position and account ID |
| Bank/manual source records | `raw_records` | Transaction ID, account/source, complete payload |
| Manual decisions | `transaction_overrides` | Transaction ID, overrides, splits, duplicate links, revision |
| Cached classifications | `classifications` | Transaction ID, source hash, classifier/version, result |
| Published ledger | `processed_transactions` | Ledger row ID, split/parent references, published state |
| Plaid access tokens | `plaid_tokens` | Item ID and token |
| Link sessions | `link_sessions` | Session ID and Link state |
| Migration evidence | `migrations` | Migration ID, verification report, counts, source digests, backup path |

`processed_transactions.cashflow_cents` uses integer cents. Source/ledger account references use deferred foreign keys. Overrides and classification caches may outlive deleted raw records. A published parent reference can temporarily be absent from the latest raw snapshot.

The database and backups contain unencrypted connection tokens and settings. Private files/directories are created with 0600/0700 permissions; API responses are filtered by the service layer. These permissions do not provide encryption or isolation from processes running as the same OS user.

## Writes, startup, and recovery

`Repository` provides in-memory snapshots and a serial writer queue. A change clones the state, applies business logic, validates it, and commits changed entities and the revision under `BEGIN IMMEDIATE`. Only a successful SQL commit replaces the in-memory snapshot. Failed writes roll back, and a database revision check rejects external conflicting writes.

SQLite uses `journal_mode=DELETE` and `synchronous=FULL`. A temporary `respect-money.sqlite-journal` may appear; WAL is not used. The `.writer-lock/` directory prevents the app, migration, and backup/restore commands from writing simultaneously. Dead process locks can be recovered; never manually remove a live process's lock.

Startup checks the database application ID, schema version, integrity, foreign keys, and business structures. It loads published transactions without republishing and marks unfinished jobs interrupted. If SQLite exists, startup never falls back to stale JSON.

## Legacy migration

Stop the application before either migration. New installations require neither step.

Migrate any legacy JSON ledger **before** importing its environment settings. For JSON already in the standard `data/` directory:

```sh
npm run migrate:sqlite
```

The command targets `data/`; it does not read the old environment file to select another directory. If legacy JSON is in `data/sandbox/` or a custom directory, invoke the same migration module with that explicit source path instead (replace the example path with your actual source):

```sh
npx tsx --eval 'import { migrateLegacyData } from "./src/server/storage/migration.ts"; migrateLegacyData("data/sandbox").catch((error) => { console.error(error.message); process.exitCode = 1; });'
```

Once the source ledger is SQLite, run `npm run migrate:settings` if `.env` / `.env.local` exists. This importer validates the old settings and copies a custom/Sandbox source database into `data/` only when no destination database exists. It backs up the destination ledger before saving settings, verifies them before removing imported environment files, and retains the original source database. Conflicts or unsupported configuration are preserved for review. It refuses unmigrated JSON rather than migrating it automatically.

The JSON-to-SQLite migration:

1. Acquires the writer lock and finishes committed legacy staging transactions.
2. Validates known files, schemas, IDs, account/month relationships, duplicate records, and override conflicts. Unknown files or unmappable fields cause failure.
3. Saves a complete JSON backup and SHA-256 manifest under `data/backups/before-sqlite-.../`.
4. Imports into a temporary database and compares canonical full-state hashes, raw source hashes, account/month ledger totals, integrity, and foreign keys.
5. Writes the `legacy-json-v1` verification record, closes and synchronizes the database, and installs it by atomic rename.
6. Leaves the old JSON files intact. Subsequent runs verify the migrated database rather than replacing later edits. A database without the expected migration marker is not overwritten.

Migration does not call Plaid or a model, reclassify transactions, rebuild the published ledger, or change IDs, source facts, splits, and enabled ranges. On failure, the original source and completed backup remain available.

## Backups and restore

Stop the application, then run:

```sh
npm run backup
npm run restore -- data/backups/<backup-directory>
```

Backup uses SQLite's native backup API, reloads and verifies the snapshot, then writes the version 2 checksum manifest last. A directory without a manifest cannot be restored. Backups include settings, prompts, Plaid credentials, reclassification rules, wealth history, and migration records. Store the whole directory privately; Git is not a financial-data backup.

Restore supports version 2 SQLite and version 1 JSON backups. It validates manifest paths, checksums, integrity, and business structure. A valid existing database receives a `before-restore-*` backup before transactional replacement of its business tables; its migration history is retained. An empty destination can be initialized from backup. Existing unmigrated JSON must be migrated first to avoid overwriting it.

### Damaged-database recovery

If the current database cannot be opened, the restore command will not overwrite it directly:

1. Stop all application and maintenance processes using the directory.
2. Preserve the database and matching `-journal`, if present, in a private archive such as `data/backups/damaged-<timestamp>/`. Do not discard the journal or the damaged database.
3. If old `raw/`, `manual/`, `processed/`, `overrides/`, `meta/`, or `private/` JSON directories remain, move them into the same archive so startup does not identify them as unmigrated data.
4. Run `npm run restore -- <verified-backup-directory>` with no active database or legacy JSON at the data root, then restart the app.

Do not reimport obsolete JSON in place of a recent SQLite backup. Keep the archived files until recovery has been independently verified.

## Settings, rules, and compatibility

The optional `settings` object in `app_metadata.state` stores validated configuration with an independent revision. Initialization adds default settings to older databases without republishing the ledger. `readConfig()` reads this metadata to select the listening port. Plaid environment/client/secret/redirect, classifier model/prompt/executable/timeout, and optional `displayConversion` settings (`enabled`, three-letter `currency`, and a positive `rate` per USD) are stored here. Legacy `usdCnyRate` values resolve to enabled CNY conversion when `displayConversion` is absent; reads do not rewrite old metadata. Browser language remains in browser storage.

The public settings API omits the secret. Empty secret edits preserve it; explicit removal clears it. Active jobs prevent configuration changes. Prompt/model changes affect future classifications and their fingerprints, while existing results are retained until explicit reanalysis. Manual overrides retain precedence. The data root is fixed at `data/`; the selected Plaid environment no longer changes the directory.

The optional `reclassificationRules` array stores examples, category, direction, ID, and per-rule revision. Previews are temporary process memory; applying selected matches atomically writes version-checked overrides and republishes. Rule examples can contain private financial details and belong only in local storage.

Optional `wealth` metadata stores manual assets, cached balances, refresh errors, and daily history. Snapshots preserve their captured conversion currency, rate, enabled state, and asset/account details rather than deriving them from today's state.

Startup normalizes the former `investment_income` and `investment_fees` categories to `investments` in overrides, splits, caches, published rows, and rules. Income, expense, and refund types remain distinct. Raw payloads and hashes remain unchanged. Legacy IDs remain readable for backup/client compatibility. Reopening normalized data does not repeat the migration.

## Verification

Temporary-directory tests cover full-state migration fidelity, source hashes, splits, cross-month records, orphan overrides, stale published snapshots, repeated migration, staging recovery, rejected malformed inputs, transaction rollback, process death during writes, writer locks, revisions, checksummed backups, and both restore formats. API and browser tests cover the associated user workflows. See [Implementation status](IMPLEMENTATION_STATUS.md).

Category definitions and deletion redirects are stored in application settings and included in backups. Dedicated category endpoints use the settings revision for concurrency control. Deletion updates overrides, splits, caches, rules and published rows atomically while preserving raw payloads. Published legacy activity kinds are projected into a neutral category and a separate cashflow type; category inclusion is stored separately from explicit transaction exclusions. Legacy manually confirmed cashflow types are retained when upgrading.
