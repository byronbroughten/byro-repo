# byro-repo#293 outcome

Spec: [byro-repo#294](https://github.com/byronbroughten/byro-repo/issues/294)

| Issue | Pair | Account | Files changed | Peak context | Result | Defers | Review rounds | Retries | Duration | Cost (API-equivalent) | Triage cost | Limit used | What review caught | Session ids |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #293 | unrecorded | unrecorded | 6 | unrecorded | Fix | 1 | 1 | 0 | unrecorded | unrecorded | unrecorded | unrecorded | Standards: the dirty-repos filter duplicated in IssueWorkspaces and SpecRun, and two near-identical worktree types (fixed: one `RepoWorktree` and `dirtyReposOf` in git.ts); SpecRun's worktree loop duplicated beside `_headsOf` (fixed: one `_worktreesOf`); `_worktreeStatesOf` named for a type it didn't return (fixed: `_repoWorktreesOf`). Deferred: `WorktreeState.branch` uses "" for detached against the undefined-for-absent rule; the spec's shape sets it, and the developer kept "". Kept: `releaseLease`/`leaseOf` stay async as public API. Spec: WrapUp's pre-landing branch-and-dirtiness check still read the same worktrees twice (fixed: restore hands the clean check its unswitched reads). | unrecorded |
