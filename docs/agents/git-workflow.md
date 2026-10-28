# Git workflow

Primary checkouts and workspaces, branches and commits, landing a spec or a session with the wrap-up script, and closing a parent once its last sub-issue lands.

## Primary checkouts and workspaces

- **A primary checkout is a repo's one long-lived clone** (the root and each clone under `packages/`); an **issue workspace** is a disposable set of checkouts, one per repo, where one ticket is implemented, and a **session workspace** is the same for work with no ticket: docs, grilling, mining ([`runner/GLOSSARY.md`](../../runner/GLOSSARY.md)). Primary checkouts take no edits; every edit happens in a workspace, and a primary only fast-forwards when one lands.
- **The runner works a spec's tickets one at a time, each in its own issue workspace**: `npm run runner -- <owner/repo> <n>`, rerun to resume. A ticket it Stops on stays unlanded in its workspace; finish it there by hand and land it with `npm run wrap-up -- <repo> <n>`.
- **Two hooks keep a primary checkout clean, and the way through for both is a workspace**: `branchGuard.ts` and `primaryEditGuard.ts` ([what each denies](../claude-code-guardrails.md#the-hooks-and-the-project-agent)).
- **An interactive session opens a workspace with `/start-issue <repo> <n>`**, or `--session <slug>` for a session workspace, which is on `session-<slug>` in every repo. It runs `npm run issue:start` on the same arguments, which resumes the workspace or creates it, gives an issue workspace the branch the runner would, takes its lease for the `claude` that ran it, and prints its path (after a line saying so when the session is already in it) with the ticket's Model fit and comments, then moves the session there with `EnterWorktree`. `issue:start` refuses a workspace another live run or session leases, naming the holder. From a shell, `npm run issue:start -- <repo> <n> --claude` opens Claude Code at the primary root already running `/start-issue` on the same arguments; `--no-prompt` opens a bare session.
- **A workspace's lease ([`runner/GLOSSARY.md`](../../runner/GLOSSARY.md)) is released when the session holding it ends**, so a session never releases one by hand.
- **A Halt can leave an issue workspace behind.** `npm run issue:list` shows each workspace's issue or session, branched repos, dirtiness, lease holder and age. `npm run issue:remove -- <repo> <n>` (or `-- --session <slug>`) removes one, refusing a dirty workspace, or a detached repo holding commits no branch has, unless `--force`, and refusing a live lease even with it.
- **Workspaces live in the primary root's `.claude/worktrees/`**, where `EnterWorktree` enters without an approval prompt.

## Branches and commits

- **Commit freely; push only through wrap-up, or with a yes.** Git can undo a commit on any branch, so it needs no yes; a raw `git push` asks ([the tier list](../targets-and-gates.md#which-tier-an-action-is-in)). Starting a runner run is the yes for what the runner's own code writes on that spec's issue tree in the named repo: comments, closing its tickets, pushing `issue-*` branches and wrap-up merges. It also covers the implement step running `gh issue edit` and `gh issue comment` as the ticket describes them. It never covers an agent step closing an issue, changing a triage label on a ticket of the running spec, a write outside its ticket's targets, or any other write an agent step attempts.
- **In an interactive session, a write to another ticket needs the developer's yes first**, even one in the same spec: editing its body, or commenting on it.
- **Implement a spec on a branch named for it**: `issue-<n>-<short-slug>`. If other work is already in flight, ask which branch to use.
- **Each clone under `packages/` is its own repo; its branches and commits go there, not to the root.** Run git for it with `git -C packages/<name>`, and read a branch's `<n>` against the repo that branch lives in.
- **A change that spans repos is one commit per repo**, each on a branch in its own repo. They share the one wrap-up, and a repo lands before any repo that depends on it, so a fresh workspace never pulls a dependent's half without its dependency's: a clone before the root, and a breaking change to the framework's public entry before the app's fix. Commit messages get no package prefix.
- **A `backup/*` branch is single-session scaffolding.** Take one before a history rewrite, retire it once the rewrite is verified, and say so. If a stale one exists, report it with its ahead/behind counts before starting other git work.
- **A `research/*` branch is permanent and never merged.** Wayfinder's research tickets keep their findings there, and the issue's closing comment links to the file on the branch, so merging adds a doc master was never meant to hold and deleting breaks the link. An unmerged `research/*` branch is expected.
- Commit messages and `gh` writes from a dispatched agent go back to the main session: [`delegation.md`](./delegation.md).

## Landing a spec

- **After a spec is implemented**, do not ask whether to land it, and do not merge, push, close or delete anything yourself. The one exception, interactive-only for now: an interactive session (`/implement-code`) reviews, resolves and reports: it runs the runner's review on its ticket, resolves the findings itself under the run's verdict rules (past the ticket budget, a fresh resolver does), posts a report of what review caught, what was fixed and each Propose with its recommendation, and waits for the developer's go-ahead before wrap-up. A run keeps landing unattended. The runner's wrap-up script lands it: `npm run wrap-up -- <repo> <n>`, reading `.runner/<repo>-<n>.facts.json` (the `WrapUpFacts` shape in `runner/src/FactsFile.ts`), which the runner writes during a run and a session's tooling during an interactive one, the interactive review adding each review and resolve session it starts. Nobody passes branches: wrap-up lands each repo whose `issue-<n>-*` branch is ahead of master, in the config's clone order with the root repo last, so a repo lands before any repo that depends on it. An interactive agent passes only the closing facts: `npm run wrap-up -- <repo> <n> --closing "…" [--undone "<box>: <reason>"]...`, and adds `--no-code` for a ticket with no branch ahead and no GitHub writes, such as one that only edited a Doc; a wrap-up with no closing comment in either place fails naming `--closing`. When the facts file also carries the recorded session ids, each with its account and config folder (`sessions`), the script computes pair, peak context, duration, cost and review cost from them, reading earlier implementer sessions from each handoff comment's `session: <id>` line; a fact it can't compute is written `unrecorded`. It stops at the first failure, naming its kind, and a rerun skips the steps already done.
- **A ticket that changes wrap-up or the facts file's format lands through its workspace's own script**: `node <workspace>/scripts/runner/wrapUp.ts <repo> <n> --closing "…"`, run from the primary root. `npm run wrap-up` runs master's code, which can't read what the branch's code wrote (#367).
- **Wrap-up runs `npm run prepare` at the primary root once the primaries fast-forward**, since a workspace copies `node_modules` and never runs it; a failure only warns (#407).
- **A writing Research spec wraps up per `packages/personal/writing/docs/wrap-up.md`** instead of the script. A Piece lands by the script, its branch holding the Snapshot.

## Landing a session

- **Once a session workspace's edits are done, land it without asking**: `npm run wrap-up -- --session <slug>`. Wrap-up holds the standing yes to push, behind its secret scan (#273). It fast-forwards master in each repo whose `session-<slug>` branch is ahead, clones before the root, with no checks, outcome row or GitHub calls, then deletes the session branches, releases the lease and removes the workspace. It refuses uncommitted changes, so commit first.
- **To land mid-session and keep working, add `--keep`**: the edits so far land the same way, and the workspace stays leased with every session branch level with master. Land this way whenever a finished piece of work would otherwise wait on the rest of the session.

## Closing a parent

- **The parent close-out prompt** is the one the wrap-up points to when a parent has every sub-issue closed, for the developer to hand to a fresh agent. Boxes stay unticked; each sub-issue's closing comment is the record of what landed.

  ````
  Close out parent #<p> in <owner/repo>, whose sub-issues are all closed. Work from these issues; open master only to settle a doubt about one item.
  1. Read #<p>'s body, its sub-issue list (`gh api repos/<owner/repo>/issues/<p>/sub_issues`) and each sub-issue's last comment, its closing comment.
  2. List the gaps: each user story or implementation decision in #<p> that no sub-issue title or closing comment covers, and each closing comment naming a box left undone.
  3. With no gaps: `gh issue close -R <owner/repo> <p> --comment "<what landed, naming the sub-issues>"`, then check #<p>'s own parent by the rule `parentCheckOf` in `runner/src/WrapUp.ts` applies to a ticket's; if it is ready to close, print this prompt filled in for it rather than closing. Last, tell me to run `/mine-outcomes <repo> #<p>`.
  4. With gaps: leave #<p> open, report each gap and draft a follow-up ticket's text for me to file.
  This message is my yes to close #<p> only.
  ````
