# Respect Money

A personal finance app that runs on your computer: a React interface, optional Plaid bank synchronization, and optional Codex transaction classification. Transactions, settings, and balance history are stored in a local SQLite database.

Manual bookkeeping works without Plaid or Codex. The app supports English and Simplified Chinese. It is designed for one local user, with no public login or multi-user isolation.

## Quick start

Install Node.js 24 or later (`node:sqlite` is required). The development and CI version is Node.js 26, recorded in `.node-version`.

```sh
git clone https://github.com/gtxistxgao/respect-money.git
cd respect-money
npm ci
npm run dev
```

Open [the local app](http://127.0.0.1:5173). Use **Settings → Language** to select English; a new browser defaults to Simplified Chinese. The choice persists in that browser and synchronizes between tabs. Create a manual account in Settings, then add a transaction in Accounting.

For a built application served from a single port:

```sh
npm run build
npm start
```

Open [the built app](http://127.0.0.1:3001). Run commands from the repository root. Stop the app with `Ctrl+C`, and run only one backend per data directory. Both startup modes listen on loopback.

## What it does

- **Overview:** compare monthly income and net spending, filter by account or year, and open category details in the ledger. Missing months and incomplete data are marked explicitly.
- **Accounting:** browse months, filter transactions, add manual entries, edit categories and countries, add notes, split purchases, and review uncertain or duplicate records.
- **Wealth:** view assets, debts, net worth, account balances, manual assets, and locally saved balance history. Overview, Account balances, and Balance history have separate navigation entries.
- **Settings:** manage bank connections and accounts, language, classification prompts and models, example-based reclassification, display exchange rates, and advanced configuration.

The interface uses a compact dark theme, local Inter fonts, and scrollable tables on small screens. Product requirements are in [PRD](docs/PRD.md); the current architecture and original delivery milestones are in [Engineering plan](docs/ENGINEERING_PLAN.md).

## Accounting rules

Totals include posted USD transactions from enabled accounts. Pending, non-USD, excluded, and unresolved transactions remain available for review but do not contribute to income or spending.

| Activity | Treatment |
| --- | --- |
| Purchase | Spending in its posting month |
| Refund | Reduces spending in the refund's posting month; net spending may be negative |
| Transfer between your accounts or credit card repayment | Excluded from income and spending |
| Cash dividends and interest | Income |
| Standalone investment fee | Spending |
| Securities trade or automatic reinvestment | Excluded from income and spending |
| Split purchase | Count the split rows once; their sum must equal the original amount |

Monthly totals depend on the selected month and accounts. Column filters have a separate subtotal. Category shares use spending before refunds; refunds and net spending are shown separately. The All transactions view also includes excluded activity, so its net cash flow is not the same as income minus spending.

Bank facts are preserved. Manual categories, countries, notes, exclusions, and splits survive synchronization and automatic classification. If a bank changes an amount that no longer matches a split, the transaction requires review. Possible duplicates between manual and imported records require explicit confirmation; the manual original is retained.

## Connect a bank

Open **Settings → Bank connections**, enter your Plaid client ID and secret, select the matching Sandbox or Production environment, and save. Credentials are stored in the local database. The settings API returns only whether a secret is present; a blank secret input preserves it, and the removal checkbox clears it.

1. Select **Connect account**, choose an institution in Plaid Link, and authorize the accounts you want to import. Respect Money does not receive your bank password.
2. Checking, credit, and investment accounts are identified from the returned account types. Account switches control inclusion in Accounting.
3. The first synchronization enables transactions from **2026-01-01 through today**. Use the date-range controls to request earlier history.
4. Use **Manage accounts** on an existing connection to add accounts or consent. Use **Reauthorize** for an expired connection. Reusing the connection preserves its identity and history.
5. Disconnecting removes access to the Plaid Item while retaining imported local history. See the confirmation in Settings before disconnecting.

Existing connections are tied to their Plaid environment and client ID. Those fields cannot be changed while accounts are connected; secret rotation is supported. Wait for active synchronization or classification jobs to finish before changing configuration.

The app requests Transactions and consent for Investments through one Link flow, then reads the products applicable to each account. See [Plaid's product initialization guide](https://plaid.com/docs/link/initializing-products/). Availability and charges depend on your Plaid account and institution. Automated fixtures do not establish that any particular real bank account can connect.

If an institution requires a redirect, configure the optional redirect URL and your Plaid Dashboard according to [Plaid's OAuth guide](https://plaid.com/docs/link/oauth/). Production redirect URIs require HTTPS; this app provides local HTTP by default and does not configure TLS or the Dashboard for you.

## Synchronization and classification

In Accounting, **Sync bank data** accepts a month, year, or custom date range. Date boundaries use `America/Los_Angeles`, including daylight saving time; the current month ends today. Jobs run in the backend, so closing the browser does not cancel them. Stopping the backend interrupts unfinished jobs, which can be retried.

Normal synchronization reads data already available from Plaid. The optional bank-refresh setting requests an upstream update and reports waiting or failure. New Transactions connections request 730 days of history, while the initially enabled ledger starts in 2026. Enabled ranges are merged: a narrower sync does not remove existing months. **Settings → Historical coverage** distinguishes enabled ranges, observed transaction dates, and provider status; observed dates do not prove that earlier months had no activity. Investment history is also limited by the provider; existing older local records are retained.

Automatic classification requires an installed, signed-in Codex CLI. In **Automatic classification**, choose a model and edit the full prompt. In **Advanced settings**, configure the executable and timeout. A blank model uses the CLI default; the model picker queries the installed CLI's model catalog. The app does not modify global Codex configuration.

```sh
npm run codex:check
```

This optional check sends one fictional Tokyo cafe transaction through the configured classifier. It requires network access and a working CLI login. Automated unit and browser tests use fixtures instead.

Classification sends selected descriptions, dates, amounts, and location/category clues to the signed-in model service, in batches of at most 50 records / 24 KB. **Local storage does not mean offline AI processing.** Plaid credentials are not included in the prompt or subprocess environment. The runner uses a temporary directory, disables tools, validates structured output, and removes temporary files afterward. See [Security and privacy](SECURITY.md) for the boundaries.

Synchronization preserves saved classifications and manual edits. Changing the model, prompt, or bank record does not automatically rerun an existing classification; explicitly reclassify with reanalysis enabled. Classification failure keeps the last successful ledger and marks it stale. Retry classification, or publish using bank rules and review the results manually. Unknown countries default to US with their source marked as a default. The default prompt requests Chinese explanations; edit it to request English. Generated explanations are not automatically translated by the UI.

**Settings → Reclassify** supports locally saved example-based rules. Enter examples or a recipient/text/amount pattern, select a category and cash flow direction, then scan existing transactions. Review and select matches before applying. Scans cover enabled accounts across months and exclude pending, split, excluded, non-USD, repayment, and investment activity. Each model batch reviews at most 1,000 transactions. Invalid output receives one retry. Applying selected matches can replace an earlier manual category and preserves notes and countries. Changed rules or records require a new preview. Previews expire after one hour and are lost on restart; rules persist in backups. Rules run only when explicitly scanned.

## Wealth and balance history

Wealth includes all connected accounts regardless of Accounting switches. It uses cached bank balances and investment holdings to build balance information, preserving the last successful result when an update fails. Missing and non-USD balances are excluded from USD totals. It does not fetch currency markets or convert non-USD bank balances.

The asset chart groups connected accounts by account type using their full positive USD balance. Manual assets use their entered type and gross value. Debt allocation is shown separately; linked loans are counted once. Select a total or allocation segment to inspect the contributing items. Holdings and account balances are not added together twice.

Manual assets include real estate, vehicles, cash, and investments. Enter a valuation, valuation date, and debt, or link an existing USD liability account to avoid double counting. Property estimates are entered manually; the Redfin link is a lookup shortcut, not an automated valuation or address upload.

CNY equivalents are display estimates using the manually configured **Settings → USD to CNY rate** (default 6.7), not a live exchange rate. USD amounts remain the source values.

**Update balances** saves one snapshot per Pacific calendar date; another update on that date replaces it. Each snapshot retains the names, values, debts, inclusion state, and exchange rate captured at the time. Partial updates mark stale or missing values; a complete account-refresh failure does not overwrite an existing snapshot. Manual-only portfolios can also save snapshots. No history is backfilled before connection, and nothing is collected while the backend is stopped.

## Local storage, migration, and backups

```text
data/
  respect-money.sqlite    # Ledger, settings, credentials, and wealth history
  .writer-lock/           # Single-writer lock
  backups/                # Database and legacy migration backups
```

The whole directory is ignored by Git. The database and backups contain **unencrypted financial data and Plaid credentials**; keep them private and protect backup copies. New private files/directories use 0600/0700 permissions. These permissions are not encryption. Do not copy, modify, or delete an active database or its rollback journal.

Stop the application before migration, backup, or restore:

```sh
npm run backup
npm run restore -- data/backups/<backup-directory>
```

Backup creates a verified SQLite snapshot and checksum manifest. Copy the entire backup directory to private backup storage. Restore verifies it, backs up a valid existing ledger, and replaces state transactionally. Legacy JSON backups are supported. Git commits do not back up your finances.

For installations using the old JSON storage, run `npm run migrate:sqlite` before starting. For installations using legacy `.env` / `.env.local` settings, run `npm run migrate:settings` while the application is stopped. The settings importer verifies and backs up the ledger before deleting successfully imported environment files. It can copy an old Sandbox/custom data directory into an empty `data/`; it does not merge ledgers or delete the source database. Normal startup uses SQLite settings, not environment files. See [Storage and recovery](docs/SQLITE_STORAGE.md) for migration order and damaged-database recovery.

## Development and troubleshooting

```sh
npm run check                   # Typecheck, lint, unit/API tests, build
npx playwright install chromium
npm run test:e2e                # Run after build; temporary data and fake services
```

Browser tests cover built and development modes, desktop and mobile layouts, settings, synchronization, classification, and wealth. They use temporary directories and local ports 3101 and 5174; they do not access the owner's ledger or real Plaid/model services.

| Problem | Action |
| --- | --- |
| Plaid is not configured | Save matching credentials and environment in Settings |
| Bank requests login | Reauthorize the existing connection |
| History is still preparing | Retry later; existing records are retained |
| Codex fails or times out | Check CLI installation, login, model, and network; retry or use bank rules |
| An edit is rejected as stale | Refresh and reopen the editor |
| The data directory is already in use | Stop the other backend; never remove its live writer lock |
| Database cannot be opened | Follow [damaged-database recovery](docs/SQLITE_STORAGE.md#damaged-database-recovery) |

See [Contributing](CONTRIBUTING.md), [Localization](docs/I18N.md), and [Implementation status](docs/IMPLEMENTATION_STATUS.md) for development details and validation limits.

## Documentation and project page

The versioned documentation in [`docs/`](docs/) is the project's documentation hub. A separate GitHub Wiki is not required. The static introduction page at [`docs/index.html`](docs/index.html) uses fictional data and has no connection to the local ledger. See [GitHub Pages setup](docs/GITHUB_PAGES.md) before publishing it.

[Publication review](docs/PUBLICATION_REVIEW.md) records the source/history review and remaining release decisions. A repository license has not yet been selected; the icon notices in [`docs/assets/LICENSE-icons.txt`](docs/assets/LICENSE-icons.txt) cover third-party icons only.
