# byro-repo#654 outcome

Spec: [byro-repo#654](https://github.com/byronbroughten/byro-repo/issues/654)

| Issue | Pair | Account | Files changed | Peak context | Result | Proposals | Review rounds | Retries | Duration | Cost (API-equivalent) | Review cost | What review caught | Session ids |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #654 | Opus medium | 1 | 55 | 100K | Fix (resumed implementer) | 2 | 1 | 0 | 13 min | $2.33 | $3.95 | Fixed: `issueRef.issuesOutside` repeats what its return type and bundle already say, while its siblings were trimmed. (runner/src/IssueWorkspaces/workspaceTypes.ts:80). Proposed: `isMemberOf` is `issueRef.isAmong` with its arguments flipped, and `isLandedByThisRun` does the same check by comparing labels. (runner/src/BatchRecords.ts:99-101; runner/src/SpecRun/PreflightChecker.ts:200-203); `isSame(a, b)` on IssueRef, WorkspaceKey and LeaseHolder, and `outside` (formerly `issuesOutside`), keep two positional params of one type. (runner/src/IssueWorkspaces/workspaceTypes.ts:72, :80, :120; runner/src/IssueWorkspaces/workspaceLeases.ts:13). | a16c6e18-e328-443a-8f94-ec4ffbf4c3f4, 8a2ec3d8-cc04-42dc-8b29-ce8f3084b2ae |
