# Security and privacy

Respect Money is intended for one trusted user on their own computer. The server binds to loopback and checks Host/Origin headers. It has no user authentication or tenant isolation. Do not expose it through a public listener, reverse proxy, or tunnel as a hosted finance service.

## Local secrets and financial records

`data/respect-money.sqlite` stores transaction data, Plaid access tokens, client credentials, prompts, rules, and wealth history. Backups contain the same sensitive data. They are **not encrypted by the application**. New private files use 0600 permissions and directories use 0700, but another process running as your OS user can still access them. Protect the device and backup storage accordingly.

Git ignores `data/`, local environment files, database files, key files, logs, editor state, build output, and test reports. Ignore rules do not remove already tracked content and can be bypassed by forced staging. Review staged changes before every commit. Never share databases, bank exports, real receipts, authentication files, screenshots with personal records, or raw provider/model logs in issues or pull requests.

The settings API omits the Plaid secret. Bank passwords are handled by Plaid Link or the institution, not received by this app. Disconnecting a connection removes its Plaid access through the provider; previously imported local records remain in the database and existing backups.

## External services

Bank linking and synchronization contact Plaid and the selected institution. Automatic classification sends selected transaction descriptions, dates, amounts, and location/category clues to the configured Codex model service. Example-based scans send the supplied rules and candidate details. Local persistence does not make these integrations offline.

The classifier uses a temporary working directory, an allowlisted subprocess environment, disabled tools, ephemeral execution, output validation, and cleanup. It does not intentionally supply bank tokens or repository files to the model. These controls depend on the installed CLI and are not a general operating-system isolation boundary. The app does not sandbox arbitrary executables configured by its local user. `npm run codex:check` uses fictional input but still contacts the configured service.

## Reporting an issue

Use fictional records to report ordinary bugs. Do not post active credentials, private financial records, or sensitive exploit details in public issues. For a security vulnerability, use the repository's **Security → Report a vulnerability** option if the owner has enabled private reporting. If that option is unavailable, contact the repository owner privately through an existing channel before sending sensitive details. No dedicated security mailbox or response-time commitment is currently configured.

If a real credential is committed, revoke or rotate it at its provider first. Removing it in a later commit does not erase history. Review affected branches, tags, forks, artifacts, and logs; coordinate any history rewrite with the owner instead of force-pushing silently.

## Scope of automated checks

The CI secret scan exports the committed snapshot with `git archive` and checks it with Gitleaks, with redacted findings. It does not scan earlier commits or ignored local files. Dependency review can be run with `npm audit`. Passing these checks is evidence from known patterns and advisories, not a guarantee that the application has no vulnerabilities. The dated [publication review](docs/PUBLICATION_REVIEW.md) records the exact review scope and remaining decisions.
