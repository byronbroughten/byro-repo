# Issue tracker: GitHub

Issues and specs live as GitHub issues, in the repo of the package they concern. Use the `gh` CLI for all operations.

## Which repo

| The work is in | File it in |
| --- | --- |
| `packages/framework` (framework code and docs) | `byronbroughten/sheets-framework` |
| `packages/real-estate` (the app) | `byronbroughten/sheets-real-estate` |
| `packages/utils` (domain-free utilities) | `byronbroughten/utils` |
| A Piece of reader-facing prose (`packages/writing`) | `byronbroughten/writing` |
| The root: tooling, `config/`, hooks, agent docs, CI | `ByronBroughten/byro-repo` |

**A session started at the root has no single repo to infer, so every `gh issue` call passes `-R <owner/repo>`.** A bare `gh issue` resolves to byro-repo and files or reads in the wrong place.

**The repo says which package an issue touches, so the `framework` and `real-estate` labels are retired.** Don't apply them. Working an issue, read the `AGENTS.md` files under `packages/framework/` or `packages/real-estate/` for the repo it lives in.

**Cross-repo work lives where it starts.** File a one-line follow-up issue in the other repo that links back, and reference the origin as `owner/repo#n`, never a bare `#n`, since a bare number reads against the repo it sits in. The `issue-<n>-<slug>` branch convention reads `n` against the repo of the branch being worked ([`git-workflow.md`](./git-workflow.md)).

## Conventions

- **Create an issue**: `gh issue create -R <repo> --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view -R <repo> <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list -R <repo> --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment -R <repo> <number> --body "..."`
- **Apply / remove labels**: `gh issue edit -R <repo> <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close -R <repo> <number> --comment "..."`

Triage labels are separate: [`triage-labels.md`](./triage-labels.md).

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view -R <repo> <number> --comments` and `gh pr diff -R <repo> <number>` for the diff.
- **List external PRs for triage**: `gh pr list -R <repo> --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment -R <repo>`, `gh pr edit -R <repo> --add-label`/`--remove-label`, `gh pr close -R <repo>`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view -R <repo> 42` and fall back to `gh issue view -R <repo> 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view -R <repo> <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create -R <repo> --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list -R <repo> --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit -R <repo> <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment -R <repo> <n> --body "<answer>"`, then `gh issue close -R <repo> <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
