# Project instructions

These instructions apply throughout this repository.

## Commit and push significant changes

- After completing each significant, coherent change and its relevant checks, create a Git commit and push it to the current branch's upstream before reporting the task complete.
- Significant changes include features, bug fixes, refactors, dependency changes, project configuration, and substantive product or technical documentation updates. Commit at completed milestones, rather than after every file edit.
- The user has authorized this workflow. Do not ask again for routine commit or push permission unless the user explicitly restricts it for a particular task.
- Review the diff and stage only files belonging to the completed change. Preserve unrelated work. Use a concise, descriptive commit message.
- If the current branch has no upstream, push it to `origin` with the same branch name and set its upstream. Use ordinary pushes; do not force-push or rewrite published history without explicit authorization.
- Never commit personal financial data, receipts, credentials, access tokens, or local secrets. Keep `data/` and local environment files ignored; committed examples must contain placeholders only.
- If validation, commit, or push fails, fix what can be fixed within the task and retry. Report any unresolved failure accurately; do not claim a change was pushed unless the push succeeded.
- In the final response, briefly report the commit identifier and push destination, or the specific reason they could not be completed.
