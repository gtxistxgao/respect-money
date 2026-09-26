# Contributing

Use Node.js 26 (see `.node-version`) and install the locked dependencies with `npm ci`. Runtime support starts at Node.js 24. The application has one npm project for the frontend and backend.

## Local checks

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

`check` performs typechecking, linting, unit/API tests, and a production build. Browser tests require that build and use fictional services with temporary databases on ports 3101 and 5174. Keep those ports available. On a Linux CI machine, install browser dependencies with `npx playwright install --with-deps chromium`.

Do not connect real banks or invoke a paid model in automated tests. `npm run codex:check` is a separate, optional live integration check using one fictional transaction.

## Code, copy, and documentation

Write code, comments, identifiers, tests, and project documentation in English. Put fixed UI copy in both `src/i18n/en.json` and `src/i18n/zh.json`; Chinese translations are intentional. Preserve user content in its original language. Follow [Localization](docs/I18N.md) for message boundaries and formatting.

Use shared schemas to validate inputs. Preserve raw financial facts, integer-cent arithmetic, manual overrides, revisions, and atomic persistence. Add meaningful tests for behavior changes, especially monetary rules, migration, and provider reconciliation. See [Architecture](docs/ENGINEERING_PLAN.md) and [Storage](docs/SQLITE_STORAGE.md).

Keep the README and relevant guides aligned with the final behavior. Use only fictional examples and sanitized screenshots. The static project page is maintained under `docs/`; its entire directory becomes public when published through Pages.

## Safe commits

Before committing, review `git diff --cached` and `git status --short`. Never stage local financial records, credentials, receipts, backups, or logs. The ignored `data/` directory is not a test fixture source. Use temporary directories for tests and keep fixture tokens visibly synthetic.

After a significant coherent change passes its relevant checks, follow [AGENTS.md](AGENTS.md): stage only the related changes, make a descriptive commit, and push normally to the branch's upstream. In a fork, use your own upstream and submit a pull request. Do not rewrite published history or force-push without explicit authorization.

For a local current-version scan with Gitleaks 8.30.1 installed, export a clean committed snapshot and scan it:

```sh
scan_dir=$(mktemp -d)
git archive HEAD | tar -x -C "$scan_dir"
gitleaks dir --redact=100 --no-banner "$scan_dir"
```

Only committed files are exported; review and commit intended edits first. The CI workflow scans the same snapshot with a pinned scanner release and verified archive checksum. Check the actual export again before copying it to a new public repository. See [Security](SECURITY.md) and [Publication review](docs/PUBLICATION_REVIEW.md).
