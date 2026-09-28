# Respect Money — Product requirements

Updated for the implemented application on 2026-09-25. This document describes the current scope and accounting contract. It supersedes the original pre-implementation requirements; Git history retains that design. See [Architecture](ENGINEERING_PLAN.md), [Storage](SQLITE_STORAGE.md), and [Implementation status](IMPLEMENTATION_STATUS.md) for implementation details and evidence.

## Product and boundaries

Respect Money is a single-user personal finance application running on localhost. It combines manual bookkeeping, optional Plaid synchronization, and optional Codex classification with monthly review. The ledger and credentials live in `data/respect-money.sqlite`, excluded from version control.

Accounting totals include USD only. Foreign purchases settled in USD use that settled amount; their country describes where the purchase occurred. Wealth tracks USD balances and manually entered assets. Optional equivalents in a user-selected currency use a configurable display rate per USD, not live foreign-exchange data or conversion of non-USD accounts.

Plaid and Codex require the user's own service access. No particular institution, subscription entitlement, or historical coverage is guaranteed by the app. Manual entry remains available without either integration.

## Navigation and review

- **Overview:** monthly income/spending comparison, account and year filters, selected-month totals, and category shares with links to the ledger.
- **Accounting:** year/month navigation, income/spending/all-transaction views, account selection, combined column filters, separate filtered subtotals, manual entry, editing, splits, and duplicate review.
- **Wealth:** asset/debt/net-worth overview, account balance tables, manual assets, allocation details, and balance history.
- **Settings:** bank connections, accounts, historical coverage, language, classification configuration, reclassification rules, display exchange rate, and advanced settings.

Months can be selected even when no data has been received. The interface distinguishes empty results, unavailable history, unfinished bank processing, unresolved records, and stale classifications. Tables scroll within their container on narrow screens.

English and Simplified Chinese are supported. The browser default remains Chinese; Settings changes the preference. Source identifiers, comments, and fixed English text are written in English. Chinese interface translations belong in the Chinese catalog. User-entered content and model explanations retain their original language.

## Accounting contract

| Event | Required result |
| --- | --- |
| Posted purchase | Count spending in the posting month |
| Pending transaction | Retain for review; exclude from final totals |
| Own-account transfer | Exclude from income and spending |
| Credit card repayment | Exclude both the bank debit and card credit |
| Refund | Reduce spending in the refund month, allowing negative net spending |
| Ambiguous reimbursement or transfer | Require confirmation of its cash flow type |
| Cash interest or dividend | Count income |
| Standalone investment fee | Count spending |
| Securities trade, principal transfer, or automatic reinvestment | Exclude from income and spending |
| Non-USD or missing currency | Retain the record; exclude from USD totals |

For example, a $100 purchase plus its $100 card repayment produces $100 spending. An August purchase of $100 and September refund of $30 produce $100 August spending and negative $30 September spending if no other spending exists.

Source amounts, dates, descriptions, and payloads remain available. The model cannot change source facts or compute authoritative totals. Signed integer cents represent cash flow; positive means money received. Transaction type, category, country, and review status are separate fields. An unknown category alone does not prevent a known expense from being counted.

## Categories, countries, and manual decisions

Categories have stable IDs and are configurable under Settings → Categories. Defaults live in `src/shared/categories.ts`; users can add, rename and delete categories, edit their AI instructions, and control whether each category contributes to cash flow. Deleting a category requires a replacement for existing transactions and rules; Uncategorized is retained. Category and income/expense/refund type are independent. The legacy `side_business_expenses` ID maps to the neutral `side_business` category. Investment income and fees share `investments`. Inclusion changes reproject the published ledger without exposing unfinished classification work or changing source amounts.

Country means the actual transaction location, not the merchant headquarters or settlement currency. A Tokyo purchase settled in USD can be JP. Missing evidence defaults to US with `countrySource: default`, and the user can override it. Bank, model, default, and manual sources are distinguishable.

Manual accounts support cash and transactions from unsupported institutions. Manual categories, countries, notes, exclusions, splits, and confirmed duplicate links survive synchronization and classification. A $150 purchase split into $100 groceries and $50 shopping contributes $150 once. If the bank later changes the amount, the split requires review.

Potential duplicates between manual and imported transactions require confirmation. Confirming a match preserves the manual record while excluding it from double counting. It can be unlinked later. Recreating a Plaid Item does not promise automatic migration of edits to newly assigned provider IDs.

## Synchronization and classification

The initial enabled range is 2026-01-01 through today; users can request earlier dates. Boundaries follow Pacific calendar dates. Requested ranges, observed records, and provider processing status are separate concepts: a bank returning no records does not prove a complete empty period.

Transactions use paginated incremental synchronization, applying additions, modifications, removals, and cross-month corrections before saving the cursor. Investment activity uses date ranges and pagination. A failed source or account does not clear successfully retained data from others. Previously imported history remains local when the upstream service can no longer supply it. Explicitly disconnecting is destructive: remove the connection’s accounts, transactions, classifications, notes, splits, coverage, and associated job records from the app and Settings. Scrub those accounts from balance snapshots and recalculate remaining totals. Expire affected reclassification previews and prevent delayed refreshes from restoring deleted data. Keep unrelated accounts, reusable classification rules, and separately entered assets; linked loans become manual debt using the last known balance. Existing backups and exports are unchanged. On startup, clean up disconnected accounts retained by older versions.

Synchronization is explicitly triggered in the UI. Jobs survive browser navigation; unfinished jobs are marked interrupted when the backend restarts. The app does not require a public webhook receiver or perform scheduled synchronization while stopped.

Saved classifications are reused during normal synchronization. Reanalysis is explicit, including after model or prompt changes. Classification runs in bounded batches with structured-output validation and preserves manual decisions. Failure retains the last published ledger and marks it stale; a bank-rule fallback and retry are available.

Example-based reclassification is an explicit scan/preview/apply workflow. Saved rules do not automatically modify future transactions. Applying a selection can intentionally replace a prior manual category, subject to record-version checks; notes and countries remain intact.

## Wealth

All connected accounts participate regardless of their Accounting enable switch. Unknown or non-USD balances are excluded and identified. The app avoids counting both holdings and the containing account balance. Asset allocation groups connected accounts by account type; manual assets use their entered type. Debt allocation is separate, and linked liabilities are counted once.

Manual assets store valuation date, value, and debt or a linked liability account. Real estate estimates are manually entered. Net worth is total assets minus total debts and can be negative. Converted equivalents use a saved three-letter currency code and positive rate per USD, and are display estimates only. The Exchange rate card has an enable/disable toggle plus currency and rate inputs. Disabling hides conversions without changing USD totals or clearing the saved inputs. Existing settings retain enabled CNY conversion and the saved rate.

Successful balance updates save one snapshot per Pacific day, replacing that day's previous snapshot. Snapshots retain their captured values, names, debt links, inclusion state, and conversion currency, rate, and enabled state, except when disconnected account data is explicitly removed. Partial data is marked; total account-refresh failure preserves an existing snapshot. Manual-only portfolios can save snapshots. History is not backfilled before connection.

## Persistence and privacy

SQLite atomically stores accounts, connections, raw records, overrides, classifications, published rows, jobs, ranges, settings, credentials, rules, and wealth state. There is one active `data/` directory for either selected Plaid environment; changing environment/client identity is blocked while connected. The former `data/sandbox/` layout is a migration source, not the current startup path.

Backups include credentials and are not encrypted by the app. Owner-only file permissions reduce local exposure but do not protect against other software running as the same user. Bank synchronization contacts Plaid; classification sends selected transaction details to the configured model service. These boundaries must be visible in setup and security documentation.

## Acceptance and deferred work

Automated checks use fictional fixtures and temporary directories. Core acceptance includes repeated sync without duplicates, cross-month corrections/refunds, preserved overrides, split conservation, interrupted writes, verified restore, stale edit rejection, combined filters, language switching, partial provider failures, and wealth history. Live provider testing requires separate user authorization and must not be represented by fixture results.

Deferred scope includes portfolio profit/loss analysis, receipt upload/OCR, multi-user/public hosting, multi-device synchronization, budgets, subscription detection, and automatic scheduled collection. Wealth balances do not imply portfolio performance analysis.
