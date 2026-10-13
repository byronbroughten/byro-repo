# Git workflow

Primary checkouts and issue workspaces, branches and commits, landing a spec with the wrap-up script, and closing a parent once its last sub-issue lands.

## Primary checkouts and issue workspaces

- **A primary checkout is a repo's one long-lived clone** (the root and each clone under `packages/`); an **issue workspace** is a disposable set of checkouts, one per repo, where one ticket is implemented ([`runner/GLOSSARY.md`](../../runner/GLOSSARY.md)). Primary checkouts never change branch; all issue work happens in an issue workspace. Direct edits on master stay allowed in a primary checkout (docs, grilling, mining).
- **The runner works a spec's tickets one at a time, each in its own issue workspace**: `npm run runner -- <owner/repo> <n>`, rerun to resume. A ticket it Stops on stays unlanded in its workspace; finish it there by hand and land it with `npm run wrap-up -- <repo> <n>`.
- **The branch hook (`branchGuard.ts`) is strict**: it denies every branch-moving git command in a primary checkout. The way through is the issue workspace.
- **A Halt can leave an issue workspace behind.** `npm run issue:list` shows each one's issue, branched repos, dirtiness and age. `npm run issue:remove -- <repo> <n>` removes one, refusing a dirty workspace, or a detached repo holding commits no branch has, unless `--force`.

## Branches and commits

- **Commit or push only when asked.** A skill's approval step covers its edits, not a commit. Ask before committing, and ask which branch to use. Starting a runner run is the yes for what the runner's own code writes on that spec's issue tree in the named repo: comments, closing its tickets, pushing `issue-*` branches and wrap-up merges. It also covers the implement step running `gh issue edit` and `gh issue comment` as the ticket describes them. It never covers an agent step closing an issue, changing a triage label on a ticket of the running spec, `app:*`, or any other write an agent step attempts.
- **Implement a spec on a branch named for it**: `issue-<n>-<short-slug>`. If other work is already in flight, ask which branch to use.
- **Each clone under `packages/` is its own repo; its branches and commits go there, not to the root.** Run git for it with `git -C packages/<name>`, and read a branch's `<n>` against the repo that branch lives in.
- **A change that spans repos is one commit per repo**, each on a branch in its own repo. They share the one wrap-up, and a repo lands before any repo that depends on it, so a fresh workspace never pulls a dependent's half without its dependency's: a clone before the root, and a breaking change to the framework's public entry before the app's fix. Commit messages get no package prefix.
- **A `backup/*` branch is single-session scaffolding.** Take one before a history rewrite, retire it once the rewrite is verified, and say so. If a stale one exists, report it with its ahead/behind counts before starting other git work.
- **A `research/*` branch is permanent and never merged.** Wayfinder's research tickets keep their findings there, and the issue's closing comment links to the file on the branch, so merging adds a doc master was never meant to hold and deleting breaks the link. An unmerged `research/*` branch is expected.
- Commit messages and `gh` writes from a dispatched agent go back to the main session: [`delegation.md`](./delegation.md).

## Landing a spec

- **After a spec is implemented**, do not ask whether to land it, and do not merge, push, close or delete anything yourself. The runner's wrap-up script lands it: `npm run wrap-up -- <repo> <n>`, reading `.runner/<repo>-<n>.facts.json` (the `WrapUpFacts` shape in `runner/src/WrapUp.ts`). The implementer passes the branches in landing order (yours to decide; see the spanning rule under Branches and commits), the closing comment, any box left undone, whether review fixes were needed and what review caught. When the facts file also carries the recorded session ids and account config folder (`sessions`) and limit readings (`limitReadings`), the script computes pair, peak context, duration, cost, triage cost and Limit used from them, reading earlier implementer sessions from each handoff comment's `session: <id>` line; a fact it can't compute is written `unrecorded`. It stops at the first failure, naming its kind, and a rerun skips the steps already done.
- **A piece spec with no branch wraps up per `packages/writing/docs/wrap-up.md`** instead of the script.

## Closing a parent

- **The parent close-out prompt** is the one the wrap-up points to when a parent has every sub-issue closed, for the developer to hand to a fresh agent. Boxes stay unticked; each sub-issue's closing comment is the record of what landed.

  ````
  Close out parent #<p> in <owner/repo>, whose sub-issues are all closed. Work from these issues; open master only to settle a doubt about one item.
  1. Read #<p>'s body, its sub-issue list (`gh api repos/<owner/repo>/issues/<p>/sub_issues`) and each sub-issue's last comment, its closing comment.
  2. List the gaps: each user story or implementation decision in #<p> that no sub-issue title or closing comment covers, and each closing comment naming a box left undone.
  3. With no gaps: `gh issue close -R <owner/repo> <p> --comment "<what landed, naming the sub-issues>"`, then check #<p>'s own parent by the rule `parentCheckOf` in `runner/src/WrapUp.ts` applies to a ticket's; if it is ready to close, print this prompt filled in for it rather than closing.
  4. With gaps: leave #<p> open, report each gap and draft a follow-up ticket's text for me to file.
  This message is my yes to close #<p> only.
  ````
