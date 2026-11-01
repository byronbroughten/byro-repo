# byro-repo#528 outcome

Spec: [byro-repo#500](https://github.com/byronbroughten/byro-repo/issues/500)

| Issue | Pair | Account | Files changed | Peak context | Result | Proposals | Review rounds | Retries | Duration | Cost (API-equivalent) | Review cost | What review caught | Session ids |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #528 | Opus medium | 2 | 3 | 85K | Fix (resumed implementer) | 0 | 1 | 0 | 12 min | $1.86 | $2.80 | Fixed: `ended` clashes with this file's meaning of an ended supervision. (runner/src/SupervisionRecords.ts:95); `members.length > 1` stands in for 'a Batch's record' unnamed. (runner/src/SupervisionRecords.ts:96); Event-file paths are built two ways side by side. (runner/src/SupervisionRecords.ts:99-100); A solo run that hasn't written a line yet leaves the record on the old Batch file. (runner/src/SupervisionRecords.ts:100 (isWrittenAfter)); The relaunch test never models a Restart, where the Batch record is kept. (runner/src/SupervisionRecords.test.ts:383). | 0325b37f-a405-47fc-8aed-f071b2612005, 6357b010-88b7-4d94-af61-c760cb16e6bf |
