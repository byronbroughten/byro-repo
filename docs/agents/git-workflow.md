# Git workflow

- **Commit or push only when asked.** A skill's approval step covers its edits, not a commit. Ask before committing, and ask which branch to use.
- **Implement a spec on a branch named for it**: `issue-<n>-<short-slug>`. If other work is already in flight, ask which branch to use.
- **After a spec is implemented**, do not ask whether to land it. End your reply with one wrap-up prompt in one fenced block for the developer to hand to a fresh agent, however many repos the issue's branches span, and do not merge, push, close or delete anything yourself. Fill in the number, the issue's repo, the closing comment, and one line per branch in landing order (yours to decide; see the spanning rule below):

  ````
  Wrap up #<n>, in this order, stopping at the first failure and reporting it. Its branches, in landing order:
  - `<repo path>`: `issue-<n>-<slug>`
  1. In each listed repo, confirm the working tree is clean and the branch's work is committed.
  2. Model-fit answers: ask me which model and effort pair implemented it, its peak `/context`, and yes or no: did /code-review flag anything that I then had fixed? Count Files changed now, before the merges empty it: the sum of `git -C <repo path> diff --stat master...<branch>` over the listed branches.
  3. In landing order, merge each branch into its repo's master with a merge commit titled "Merge <branch> into master (#<n>)". Then run `npm run tsc`, `npm test` and `npm run lint` from the root.
  4. On the root's master, add the row to the outcome log in `docs/agents/model-fit.md`, trim it to the latest ~20, and commit it as "Record the #<n> outcome: <pair>, <files> files, <peak>, <first-try pass or fixed after review>."
  5. In landing order, push each listed repo's master, ending with the root's if the root is not listed.
  6. In landing order, delete each repo's branch on the remote if it exists, then locally.
  7. Only after every master is pushed and every branch deleted: `gh issue close -R <owner/repo> <n> --comment "<what landed, one or two sentences, plus any box left undone>"`.
  This message is the developer's yes to merge these branches, commit the log row on the root's master, push, delete these branches and close, for this issue only.
  ````

  Add a line above the block if the checks were not all green or a box in the issue is undone, so the developer sees it before handing the prompt on.
- **A piece spec with no branch wraps up per `packages/writing/docs/wrap-up.md`** instead of the prompt above.
- **Each clone under `packages/` is its own repo; its branches and commits go there, not to the root.** Run git for it with `git -C packages/<name>`, and read a branch's `<n>` against the repo that branch lives in.
- **A change that spans repos is one commit per repo**, each on a branch in its own repo. They share the one wrap-up prompt, and a repo lands before any repo that depends on it, so a fresh workspace never pulls a dependent's half without its dependency's: a clone before the root, and a breaking change to the framework's public entry before the app's fix. Commit messages get no package prefix.
- **A `backup/*` branch is single-session scaffolding.** Take one before a history rewrite, retire it once the rewrite is verified, and say so. If a stale one exists, report it with its ahead/behind counts before starting other git work.
- Commit messages and `gh` writes from a dispatched agent go back to the main session: [`delegation.md`](./delegation.md). The wrap-up prompt is the exception: it is the developer's own hand-off to a separate session, not a dispatch.
