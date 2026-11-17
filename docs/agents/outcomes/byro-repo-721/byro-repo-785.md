# byro-repo#785 outcome

Spec: [byro-repo#721](https://github.com/byronbroughten/byro-repo/issues/721)

| Issue | Workflow | Pair | Account | Files changed | Estimate | Peak context | Result | Proposals | Review rounds | Retries | Limit resumes | Duration | Cost (API-equivalent) | Review cost | What review caught | Session ids |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #785 | code | Opus medium | 5 | 10 | ~130K | 146K | Fix (resumed implementer) | 0 | 1 | 0 | 0 | 10 min | $1.71 | $1.87 | Fixed: streamUsage repeats _blockOf's per-run walk, so the board reads its runs twice. (runner/src/runBoard.ts streamUsage and _blockOf); The ticket number is cut out of the label string outside issueRef, which owns the label format. (runner/src/ProgressLog.ts:103-105 ticketNumberOf); accountText and streamReading both open with _latestAccountLine() then stepLaunchOfLine. (runner/src/ProgressLog.ts:64-81 accountText, streamReading); The comment on BoardRequest.accounts says what callers pass, not why. (runner/src/runBoard.ts:27); The test asserts a constant's value rather than an observable outcome. (runner/src/runBoard.test.ts:469). | 7ddac706-3322-4ae8-be51-b5be88694631 |
