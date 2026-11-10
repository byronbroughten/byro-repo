# byro-repo#673 outcome

Spec: [byro-repo#664](https://github.com/byronbroughten/byro-repo/issues/664)

| Issue | Pair | Account | Files changed | Peak context | Result | Proposals | Review rounds | Retries | Duration | Cost (API-equivalent) | Review cost | What review caught | Session ids |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #673 | Opus medium | 1 | 9 | 117K | Fix (resumed implementer) | 0 | 1 | 0 | 15 min | $2.95 | $4.10 | Fixed: The run-state read and parse is repeated in ProgressLog.ts, SpecRunBase.ts and runBoard.ts, and the board parses each state twice. (runner/src/runBoard.ts:129-133); _ticketsLeftOf returns the display text "N of M", not a count. (runner/src/runBoard.ts:106). | 13086923-1f2a-42a1-9d6d-e140986a867b, f3ce7bd6-33cd-48f1-8bb5-8aa12b81083f |
