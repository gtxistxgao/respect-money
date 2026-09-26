# Publication review

Review date: 2026-09-25. Source baseline: `85054c6`. The intended publication method is to create a **new repository from the latest committed files**, without carrying over the internal repository's Git history.

## Findings and changes

| Area | Finding | Action |
| --- | --- | --- |
| Credentials | Gitleaks 8.30.1 found no secrets in the tracked snapshot; reviewed credential literals are empty defaults or clearly synthetic test values | Added a checksum-verified scanner job for each committed snapshot |
| Local files | No tracked financial database, `data/`, environment secret file, backup, dependency tree, build output, or browser report | Extended ignore rules to database copies/journals, private keys, backup/receipt directories, logs, and editor state |
| Language | Executable source, scripts, and tests are English; Chinese UI text is in `src/i18n/zh.json` | Rewrote the mixed-language README, requirements, architecture, and storage guide in English; retained bilingual UI |
| Documentation | Old JSON paths, Sandbox layout, draft API names, navigation/theme, and wealth allocation descriptions differed from current code | Reconciled the guides against the implementation; added contribution/security documentation |
| Privacy wording | Local storage includes credentials, and AI processing contacts a model service | Documented unencrypted database/backups, local-only server boundaries, and external data flow |
| Browser verification | Two existing tests assumed a pristine shared fixture state | Restricted sorting assertions to the scenario's institutions and explicitly refreshed balances before checking totals |
| Wiki | The internal repository has no enabled GitHub Wiki | Keep `docs/` as the portable documentation hub; a new Wiki would need separate content/setup |
| License | No project license selected | Owner must choose before presenting this as a licensed open-source release; third-party icon notices are not the project license |

## Verification

- `npm run check`: passed; 122 unit/API tests across 25 files, typecheck, lint, and production build.
- `npm run test:e2e`: passed all 21 production/development browser tests after correcting the two shared-fixture assumptions.
- `npm audit`: zero known vulnerabilities reported at review time.
- Current tracked/staged source: scanned with Gitleaks 8.30.1, redacted output, no findings.
- Ignore rules, local documentation links, English-source/catalog boundaries, and copied publication files are checked before delivery.

This is a source/publication review, not a penetration test or a guarantee that every secret pattern can be detected. It does not inspect the new repository's eventual Actions logs, release assets, uploaded screenshots, or later commits. Those are separate publication surfaces. No live Plaid or model calls are part of this review.

## Export only the current committed version

Do not copy the whole working directory in Finder or include hidden files recursively. Local ignored files can contain credentials and real records even when Git is clean.

After the intended changes are committed, run from the internal repository root:

```sh
export_dir=$(mktemp -d ../respect-money-public.XXXXXX)
git archive HEAD | tar -x -C "$export_dir"
gitleaks dir --redact=100 --no-banner "$export_dir"
```

The last command requires Gitleaks 8.30.1 installed. `git archive` exports committed files only: it does not include `.git`, uncommitted edits, untracked files, or ignored local data. Keep the destination outside the original repository and review its contents before importing it into the new repository. Do not add personal example records to that export.

## Decisions before publication

1. Choose a project license and add its root `LICENSE` file. Update the README's license statement. Retain third-party icon notices.
2. The selected destination is `https://github.com/gtxistxgao/respect-money`. README clone instructions, project-page links, and the expected Pages URL use this name. Create and verify that destination before sharing it; at review time, the old URL still redirects to the private internal repository.
3. Initialize a new Git repository inside the reviewed export and push it to the intended empty destination. Copy no `.git` directory from the internal source. Creating the public repository and publishing it are separate actions from this review.
4. Run the documented checks in the destination. Enable Pages only if desired, using `main` and `/docs`; the full `docs/` tree becomes publicly accessible. A separate Wiki is optional and is not copied by a source export.
5. Use only fictional data in LinkedIn screenshots and demos. Check browser chrome, account names, paths, notifications, and developer tools before capturing them.

The npm package remains `private: true` to prevent accidental npm publication. This does not control GitHub visibility or replace a license decision.
