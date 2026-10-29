# byro-repo#426 outcome

Spec: [byro-repo#424](https://github.com/byronbroughten/byro-repo/issues/424)

| Issue | Pair | Account | Files changed | Peak context | Result | Proposals | Review rounds | Retries | Duration | Cost (API-equivalent) | Review cost | What review caught | Session ids |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #426 | Opus medium | 2 | 4 | 128K | Fix (resumed implementer) | 1 | 1 | 0 | 18 min | $2.62 | $0.92 | Fixed: The utils clone move and the inline framework clone move duplicate one renameSync shape. (runner/src/IssueWorkspaces.resume.test.ts:246-279); The prefix match misses the moved worktree when the workspace folder is reached through a symlink. (runner/src/IssueWorkspaces.ts worktreesInside). Proposed: A failed git worktree move throws for the whole read, so issue:list fails for every workspace. (runner/src/IssueWorkspaces.ts _relocateMovedWorktrees). | ef590da6-547d-46a4-a77c-8ec3349fd1b6, 972c64a9-2e1d-4dc0-b186-5a9f173901d5 |
