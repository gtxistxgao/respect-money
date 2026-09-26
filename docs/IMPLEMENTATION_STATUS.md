# Implementation status

Updated 2026-09-25. This file separates the implemented application, checks run during the publication review, and external behavior that those checks cannot establish.

## Current implementation

- Manual bookkeeping, monthly ledger and overview, filtering, edits, splits, duplicate review, and English/Chinese UI.
- Unified Plaid connections, account selection/update mode, incremental Transactions and ranged Investments synchronization, coverage reporting, retry, explicit account merges, and disconnection with local history retained.
- UI-managed credentials, prompts, models, and advanced settings; isolated classifier batches, cached results, bank-rule fallback, and explicit example-based reclassification.
- SQLite persistence, serial writes and revision checks, legacy JSON/settings migration, verified backups and transactional restore.
- Wealth overview, account/debt allocation, manual assets, configurable CNY display estimates, account balance tables, and daily Pacific-date snapshots.
- A standalone static project page with fictional data, plus versioned Markdown documentation in `docs/`.

## Publication review validation

The reviewed source baseline was `85054c6`; the preparation changes correct documentation, harden ignore rules, add a current-snapshot secret scan, and repair two browser-test assumptions about shared fixtures.

- `npm run check`: passed typechecking, ESLint, 122 tests in 25 files, and the production build.
- `npm audit`: zero known vulnerabilities reported at review time.
- Gitleaks 8.30.1: no findings in the tracked source snapshot; the final staged/exported snapshot is also checked before delivery.
- Browser regression results are recorded in [Publication review](PUBLICATION_REVIEW.md).
- The build reports a large frontend-chunk warning (over 500 KB). It completes successfully; bundle splitting remains a performance improvement rather than a release-test failure.

All automated provider/model responses use fictional fixtures. Browser servers use temporary databases. The review does not require live bank access, run migrations on personal records, or send personal transactions to a model.

## Historical milestones

M0–M6 delivered the initial local application, from the scaffold and accounting core to bank/investment synchronization, classification, and local acceptance. The original plan and per-stage test counts remain in Git history; they are historical counts, not current coverage totals.

The SQLite migration was introduced on 2026-09-07 with full-state/source-hash reconciliation, backup checksums, account/month totals, atomic installation, writer locking, and both legacy and SQLite restore support. Subsequent changes added the features listed above.

An earlier implementation record reports a successful real Codex CLI check using a fictional Tokyo transaction. That is historical evidence for the CLI available then, not validation of every future CLI version. Run the optional `npm run codex:check` against a new installation when needed.

## External verification and limitations

- The publication review makes no live Plaid calls. Fixtures verify the integration's local behavior, not access to Chase, Amex, Fidelity, Schwab, or any other institution. Confirm current permissions and available history using the intended Plaid account.
- Existing reports of successful local checks do not establish production OAuth setup, subscription entitlements, or bank statement reconciliation.
- If recreating an Item changes provider IDs, edits are not automatically migrated between those identities. Prefer update mode and inspect any reconnection carefully.
- The application is a local single-user tool. No public authentication, hosted deployment, portfolio profit/loss analysis, or receipt ingestion is implemented.
- The repository license still needs to be selected. The chosen public destination is `gtxistxgao/respect-money`. The source review does not publish the project or activate GitHub Pages.

## Current visual direction

The application uses a compact dark navy/black interface, green income, amber spending, thin borders, locally bundled Inter text, and system monospace amounts. Navigation is in the sidebar; small-screen tables scroll inside their containers. Wealth has Overview, Account balances, and Balance history sections.

The separate project page uses a light paper/navy/indigo theme and an explicitly fictional dark ledger illustration. Its styling is independent of the live application. Old references to DM Sans/Manrope, a light application theme, and top-level navigation no longer describe the app.
