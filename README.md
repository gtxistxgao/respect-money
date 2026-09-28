<p align="center">
  <img src="docs/assets/favicon.svg" alt="Respect Money logo" width="80" height="80">
</p>

# Respect Money

**Your money. Your machine. Less busywork.**

A free, local alternative to apps like Rocket Money, built around your own ledger. Bring your bank accounts together, make sense of your spending, and track your wealth—without a Respect Money subscription or a hosted Respect Money account.

Connect your accounts, sync your transactions, and let AI handle the first pass at categorization. When something looks wrong, describe the pattern and correct matching transactions in a batch. Spend your time understanding your finances instead of relabeling rows.

[Get started](#get-started) · [What it does](#what-it-does) · [Privacy](SECURITY.md) · [Documentation](#documentation-and-project-page)

## Why Respect Money?

- **Free software, no app subscription.** Run the app on your own computer. Bring your own Plaid and AI provider access; their eligibility, usage limits, and any service charges are separate.
- **Your ledger stays on your machine.** The web app and backend run locally. Transactions, categories, notes, settings, and wealth history live in your SQLite database, with backups you control. There is no Respect Money cloud storing your ledger.
- **AI sorting, with you in control.** Codex or Claude Code helps classify transaction categories and infer countries from the available clues. If it gets a recurring payment wrong, give it an example, preview similar transactions, and apply your correction together. Work through thousands of eligible records in batches instead of editing them one by one. Saved rules run when you explicitly scan; they do not silently change future transactions.
- **A practical free bank-sync option.** Eligible Plaid Trial accounts can create up to **10 Production Items** for real bank connections—room for a personal setup with checking, savings, credit cards, and investments, depending on your logins and institution support. See the [Plaid Trial details](https://support.plaid.com/hc/en-us/articles/39994173227159-What-is-the-Plaid-Trial-plan).

**Local app, clear data boundaries:** Plaid connects to your banks. When you enable AI classification or a reclassification scan, selected transaction details and any supplied rule examples are sent through your selected local Codex or Claude Code CLI to its model service. AI processing is not fully offline. Use manual bookkeeping without either integration if you want to keep those records entirely local. See [Security and privacy](SECURITY.md).

The interface supports **English and Simplified Chinese**. Accounting focuses on posted USD transactions; Wealth combines USD account balances and manual assets. The app is designed for one local user.

## Get started

### 1. Create your Plaid account

[Sign up for Plaid](https://dashboard.plaid.com/signup) and check your eligibility for its free **Trial plan**. Trial supports real bank data, including Transactions and Investments. It is available to eligible developers in the US and Canada who do not already have Production or Limited Production access. Older accounts may have different free-access terms. [Plaid's free-access guide](https://support.plaid.com/hc/en-us/articles/16194695660311-Can-I-use-Plaid-for-free) explains the difference.

The limit is **10 Items, not necessarily 10 institutions or 10 individual accounts**. One Item represents one login at one institution and can include several accounts—for example, checking and savings under the same login. Separate logins or duplicate connections can consume more Items. See [Plaid's Item definition](https://plaid.com/docs/quickstart/glossary/#item).

Deleting an Item **does not restore a Trial slot**, so reuse existing connections when managing accounts. Confirm the current limits and institution access in your Dashboard before connecting. [Trial plan limits](https://support.plaid.com/hc/en-us/articles/39994173227159-What-is-the-Plaid-Trial-plan)

To try manual bookkeeping first, skip Plaid setup and create a manual account in the app.

### 2. Run the app on your computer

Install **Node.js 24 or later**; development and CI use Node.js 26, recorded in `.node-version`. Clone the project and start the built app:

```sh
git clone https://github.com/gtxistxgao/respect-money.git
cd respect-money
npm ci
npm run build
npm start
```

Open **[http://127.0.0.1:3001](http://127.0.0.1:3001)** in your browser. This is the app running on your own computer. Keep commands in the repository root and run only one backend per data directory.

For background use on macOS or Linux, install `tmux`, stop the foreground app with `Ctrl+C`, and start it from the same directory:

```sh
tmux new-session -d -s respect-money 'npm start'
```

You can close that terminal and keep using the local page. To return to the app's console:

```sh
tmux attach-session -t respect-money
```

Detach with `Ctrl+B`, then `D`; stop the app with `Ctrl+C` while attached. `tmux` keeps the terminal session alive, but does not keep a sleeping computer running or restart the app after a reboot.

For development with live reload, use `npm run dev` instead and open [http://127.0.0.1:5173](http://127.0.0.1:5173). Both modes listen on loopback; this is not a public hosting setup.

### 3. Configure Plaid and AI classification in Settings

Open **Settings → Language** to select English if needed; a new browser defaults to Simplified Chinese. Your choice persists in that browser and synchronizes between tabs.

In **Settings → Bank connections**, enter your **Plaid client ID** and **secret** and select the matching environment. Choose **Production** for real accounts, including the Trial plan; Sandbox uses fictional test accounts. Save your settings. The app stores them in your local database, so you do not need an `.env` file.

For AI features, install and sign in to **Codex CLI** or **Claude Code** on the same computer. For Codex, follow the [official Codex CLI setup](https://learn.chatgpt.com/docs/codex/cli); you can install it with npm and sign in from your terminal:

```sh
npm install -g @openai/codex
codex login
codex --version
```

Alternatively, install a current **Claude Code** using the [official setup instructions](https://code.claude.com/docs/en/setup), then sign in:

```sh
claude auth login
claude --version
```

Claude Code must support `--safe-mode`, `--json-schema`, and `--no-session-persistence` (CLI flags checked with 2.1.222). The integration uses [headless print mode](https://code.claude.com/docs/en/headless), retains subscription login, and also permits `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` from the server environment. It does not load user/project settings or custom authentication helpers.

Then open **Settings → Automatic classification**, choose **Codex** or **Claude Code** (the provider saves immediately), then select a model and save any other edits. You can edit the classification prompt, choose a model ID manually, or leave it blank for the CLI default. If the executable is not found, set its path under **Advanced settings**. Each provider retains its own executable, model, and timeout settings. Your selected provider's model access and usage limits apply. Existing installations default to Codex; switching providers affects future tasks and preserves historical results until you explicitly reclassify them.

The current release requires a working, authenticated Codex or Claude Code CLI for AI classification and reclassification. **On the roadmap:** test open-source models, including local inference, with the aim of reducing that dependency and making fully local classification possible. This is planned work, not a feature of the current release.

### 4. Connect your bank accounts

In Settings, select **Connect accounts**, choose your institution in Plaid Link, and authorize the accounts you want to use. Respect Money does not receive your bank password. Checking, credit, and investment accounts are identified automatically from the returned account types.

Use **Manage accounts** on an existing connection to add accounts or update consent, and **Reauthorize** when the bank needs you to sign in again. Institution access depends on your Plaid account; see [connection details](#connect-a-bank) for OAuth and redirect setup if required.

### 5. Sync your transactions and let AI sort them

Open **Accounting → Sync bank data**. Choose a month, year, or custom date range and start synchronization. The first connection also starts an initial sync from **2026-01-01 through today**; you can request earlier history afterward if the provider has it.

The backend fetches the available bank and investment transactions from Plaid, then uses the selected AI provider to classify new or uncached transactions and suggest the country where each transaction took place. Countries without reliable evidence default to US and can be corrected. Progress is visible in the app; closing the browser does not stop a running job while the backend stays up.

Sync is initiated by you; this is not an always-on scheduled bank poller. Normal sync reads what Plaid currently has. The optional bank-refresh setting requests a newer upstream update where supported. Available history and freshness depend on the provider.

**Configure your categories.** In **Settings → Categories**, add or rename neutral categories such as Housing, Travel or Side business, give each one an AI prompt, and choose whether it counts toward income and spending. Income, expense and refund are independent transaction types; changing a category does not change the type. Deleting a category moves its transactions and saved rules to a replacement you choose. Uncategorized remains as the fallback.

**Correct recurring mistakes in one batch.** Open **Settings → Reclassify**, enter an example or pattern, choose the correct category and cash flow direction, and scan. Review the matches, deselect anything that does not belong, and apply your correction to the selected transactions. For example, teach the app that a recurring rent payment belongs in Housing, then fix its matches together. You can also explicitly rerun classification over a date range. Your manual decisions remain protected during ordinary synchronization and automatic classification.

### 6. Explore your ledger and wealth

Use **Overview** to compare income and spending by month, **Accounting** to inspect transactions and categories, and **Wealth** to see account balances, assets, debts, and net worth. Add property, vehicles, or other manual assets to build a fuller picture. **Update balances** saves a local daily snapshot so you can follow changes over time.

Everything you review and save stays in your local ledger. Back it up regularly using the [backup and restore commands](#local-storage-migration-and-backups); Git does not back up your financial records.

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
| Transfer between your accounts or credit card repayment | Excluded by default; configurable per category |
| Cash dividends and interest | Income |
| Standalone investment fee | Spending |
| Securities trade or automatic reinvestment | Excluded by default; configurable per category |
| Split purchase | Count the split rows once; their sum must equal the original amount |

Monthly totals depend on the selected month and accounts. Column filters have a separate subtotal. Category shares use spending after refunds. The monthly cards stack total spending, total income, total refunds and monthly balance (green when positive, red when negative); refunds still offset spending and are never added to income. The All transactions view also includes excluded activity, so its net cash flow is not the same as income minus spending.

Bank facts are preserved. Manual categories, countries, notes, exclusions, and splits survive synchronization and automatic classification. If a bank changes an amount that no longer matches a split, the transaction requires review. Possible duplicates between manual and imported records require explicit confirmation; the manual original is retained.

## Connect a bank

Open **Settings → Bank connections**, enter your Plaid client ID and secret, select the matching Sandbox or Production environment, and save. Credentials are stored in the local database. The settings API returns only whether a secret is present; a blank secret input preserves it, and the removal checkbox clears it.

1. Select **Connect account**, choose an institution in Plaid Link, and authorize the accounts you want to import. Respect Money does not receive your bank password.
2. Checking, credit, and investment accounts are identified from the returned account types. Account switches control inclusion in Accounting.
3. The first synchronization enables transactions from **2026-01-01 through today**. Use the date-range controls to request earlier history.
4. Use **Manage accounts** on an existing connection to add accounts or consent. Use **Reauthorize** for an expired connection. Reusing the connection preserves its identity and history.
5. Disconnecting revokes the Plaid Item and permanently removes its accounts, transactions, categories, notes, sync records, and account balance history from the app. Other accounts and manually entered assets remain; linked loans keep their last known debt as a manual amount. Existing backup files are not changed. See the deletion confirmation in Settings before disconnecting.

Existing connections are tied to their Plaid environment and client ID. Those fields cannot be changed while accounts are connected; secret rotation is supported. Wait for active synchronization or classification jobs to finish before changing configuration.

The app requests Transactions and consent for Investments through one Link flow, then reads the products applicable to each account. See [Plaid's product initialization guide](https://plaid.com/docs/link/initializing-products/). Availability and charges depend on your Plaid account and institution. Automated fixtures do not establish that any particular real bank account can connect.

If an institution requires a redirect, configure the optional redirect URL and your Plaid Dashboard according to [Plaid's OAuth guide](https://plaid.com/docs/link/oauth/). Production redirect URIs require HTTPS; this app provides local HTTP by default and does not configure TLS or the Dashboard for you.

## Synchronization and classification

In Accounting, **Sync bank data** accepts a month, year, or custom date range. Date boundaries use `America/Los_Angeles`, including daylight saving time; the current month ends today. Jobs run in the backend, so closing the browser does not cancel them. Stopping the backend interrupts unfinished jobs, which can be retried.

Normal synchronization reads data already available from Plaid. The optional bank-refresh setting requests an upstream update and reports waiting or failure. New Transactions connections request 730 days of history, while the initially enabled ledger starts in 2026. Enabled ranges are merged: a narrower sync does not remove existing months. **Settings → Historical coverage** distinguishes enabled ranges, observed transaction dates, and provider status; observed dates do not prove that earlier months had no activity. Investment history is also limited by the provider; existing older local records are retained.

Automatic classification requires an installed, authenticated Codex or Claude Code CLI. In **Automatic classification**, choose the provider and model and edit the shared prompt. In **Advanced settings**, configure each CLI's executable and timeout. A blank model uses the CLI default. Codex models come from its CLI catalog; Claude offers the `sonnet`, `opus`, and `haiku` aliases plus a custom model ID, subject to account access. The app does not modify global CLI configuration.

```sh
npm run ai:check       # Currently selected provider
npm run codex:check    # Explicit Codex check
npm run claude:check   # Explicit Claude Code check
```

This optional check sends one fictional Tokyo cafe transaction through the configured classifier. It requires network access and a working CLI login. Automated unit and browser tests use fixtures instead.

Classification sends selected descriptions, dates, amounts, and location/category clues to the signed-in model service, in batches of at most 50 records / 24 KB. **Local storage does not mean offline AI processing.** Plaid credentials are not included in the prompt or subprocess environment. The runner uses a temporary directory, disables tools, validates structured output, and removes temporary files afterward. See [Security and privacy](SECURITY.md) for the boundaries.

Synchronization preserves saved classifications and manual edits. Changing the model, prompt, or bank record does not automatically rerun an existing classification; explicitly reclassify with reanalysis enabled. Classification failure keeps the last successful ledger and marks it stale. Retry classification, or publish using bank rules and review the results manually. Unknown countries default to US with their source marked as a default. The default prompt requests Chinese explanations; edit it to request English. Generated explanations are not automatically translated by the UI.

**Settings → Reclassify** supports locally saved example-based rules. Enter examples or a recipient/text/amount pattern, select a category and cash flow direction, then scan existing transactions. Review and select matches before applying. Scans cover enabled accounts across months and exclude pending, split, excluded and non-USD records, including categories configured to stay out of cash flow. Each model batch reviews at most 1,000 transactions. Invalid output receives one retry. Applying selected matches can replace an earlier manual category and preserves transaction types, notes and countries. Changed rules or records require a new preview. Previews expire after one hour and are lost on restart; rules persist in backups. Rules run only when explicitly scanned.

## Wealth and balance history

Wealth includes all connected accounts regardless of Accounting switches. It uses cached bank balances and investment holdings to build balance information, preserving the last successful result when an update fails. Missing and non-USD balances are excluded from USD totals. It does not fetch currency markets or convert non-USD bank balances.

The asset chart groups connected accounts by account type using their full positive USD balance. Manual assets use their entered type and gross value. Debt allocation is shown separately; linked loans are counted once. Select a total or allocation segment to inspect the contributing items. Holdings and account balances are not added together twice.

Manual assets include real estate, vehicles, cash, and investments. Enter a valuation, valuation date, and debt, or link an existing USD liability account to avoid double counting. Property estimates are entered manually; the Redfin link is a lookup shortcut, not an automated valuation or address upload.

In **Settings → Exchange rate**, turn display conversion on or off, enter a three-letter currency code such as CNY, CAD, or EUR, and set how many units equal **1 USD**. Save settings to apply. These are manual display estimates, not live exchange rates. Turning conversion off hides converted amounts while preserving the saved currency and rate. USD amounts remain the source values. Existing settings retain their CNY rate (default 6.7).

**Update balances** saves one snapshot per Pacific calendar date; another update on that date replaces it. Each snapshot retains the names, values, debts, inclusion state, and conversion currency, rate, and enabled state captured at the time. Partial updates mark stale or missing values; a complete account-refresh failure does not overwrite an existing snapshot. Manual-only portfolios can also save snapshots. No history is backfilled before connection, and nothing is collected while the backend is stopped.

**Wealth → Balance history** starts with separate USD trends for net worth, total assets, and total debts. Click a date on any chart to select the matching snapshot below; the date picker and all three charts stay in sync. Keyboard users can focus a chart and use the arrow keys to move between saved dates. Hollow points identify partial updates.

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
npm run restore -- "data/backups/<backup-directory>"
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
| AI classification fails or times out | Check CLI installation, login, model, and network; retry or use bank rules |
| An edit is rejected as stale | Refresh and reopen the editor |
| The data directory is already in use | Stop the other backend; never remove its live writer lock |
| Database cannot be opened | Follow [damaged-database recovery](docs/SQLITE_STORAGE.md#damaged-database-recovery) |

See [Contributing](CONTRIBUTING.md), [Localization](docs/I18N.md), and [Implementation status](docs/IMPLEMENTATION_STATUS.md) for development details and validation limits.

## Documentation and project page

The versioned documentation in [`docs/`](docs/) is the project's documentation hub. A separate GitHub Wiki is not required. The static introduction page at [`docs/index.html`](docs/index.html) uses fictional data and has no connection to the local ledger. See [GitHub Pages setup](docs/GITHUB_PAGES.md) before publishing it.

[Publication review](docs/PUBLICATION_REVIEW.md) records the source/history review and remaining release decisions. A repository license has not yet been selected; the icon notices in [`docs/assets/LICENSE-icons.txt`](docs/assets/LICENSE-icons.txt) cover third-party icons only.
