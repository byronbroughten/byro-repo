# Git workflow

- **Commit or push only when asked.** A skill's approval step covers its edits, not a commit. Ask before committing, and ask which branch to use.
- **Implement a spec on a branch named for it**: `issue-<n>-<short-slug>`. If other work is already in flight, ask which branch to use.
- **After a spec is implemented**, do not ask whether to land it. End your reply with a wrap-up prompt in one fenced block for the developer to hand to a fresh agent, and do not merge, push, close or delete anything yourself. Fill in the branch, the number, the issue's repo and the closing comment:

  ````
  Wrap up issue-<n>-<slug> (#<n>), in this order, stopping at the first failure and reporting it:
  1. Confirm the working tree is clean and the branch's work is committed.
  2. Model-fit answers: ask me which model and effort pair implemented it, its peak `/context`, and yes or no: did /code-review flag anything that I then had fixed? Count Files changed with `git diff --stat master...<branch>` now, before the merge empties it.
  3. Merge the branch into master with a merge commit titled "Merge issue-<n>-<slug> into master (#<n>)", then run `npm run tsc`, `npm test` and `npm run lint`.
  4. On master, add the row to the outcome log in `docs/agents/model-fit.md`, trim it to the latest ~20, and commit it as "Record the #<n> outcome: <pair>, <files> files, <peak>, <first-try pass or fixed after review>."
  5. Push master.
  6. `gh issue close -R <owner/repo> <n> --comment "<what landed, one or two sentences, plus any box left undone>"`.
  7. Only after steps 5 and 6 succeed, delete the branch locally and on the remote if it exists.
  This message is the developer's yes to merge, commit the log row on master, push, close and delete for this branch and issue only.
  ````

  Add a line above the block if the checks were not all green or a box in the issue is undone, so the developer sees it before handing the prompt on.
- **Each clone under `packages/` is its own repo; its branches and commits go there, not to the root.** Run git for it with `git -C packages/<name>`, and read a branch's `<n>` against the repo that branch lives in.
- **A change that spans the root and a clone is two commits in two repos**, each on a branch in its own repo. Each branch gets its own wrap-up prompt, run in its repo, and the clone's side lands first, so a fresh workspace never pulls the root's half without the clone's; a breaking change to the framework's public entry and the app's fix land that way too. Commit messages get no package prefix.
- **A `backup/*` branch is single-session scaffolding.** Take one before a history rewrite, retire it once the rewrite is verified, and say so. If a stale one exists, report it with its ahead/behind counts before starting other git work.
- Commit messages and `gh` writes from a dispatched agent go back to the main session: [`delegation.md`](./delegation.md). The wrap-up prompt is the exception: it is the developer's own hand-off to a separate session, not a dispatch.
