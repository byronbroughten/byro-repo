# sheets-framework#276 outcome

Spec: [sheets-framework#219](https://github.com/byronbroughten/sheets-framework/issues/219)

| Issue | Workflow | Pair | Account | Files changed | Peak context | Result | Proposals | Review rounds | Retries | Limit resumes | Duration | Cost (API-equivalent) | Review cost | What review caught | Session ids |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #276 | code | Opus medium | 1 | 18 | 151K | Fix (resumed implementer) | 0 | 1 | 0 | 0 | 12 min | $3.10 | $4.48 | Fixed: A tab delete silently drops writes already queued on its Tables, against _removeAbsentTable's rule, and flush-order.md implies those writes are sent. (packages/framework/src/02_SpreadsheetRaw/SheetRaw.ts:98 (queueDelete), docs/architecture/flush-order.md); The Table half of the refusal test passes on Val.assert's generic message, not on the deletion guard. (packages/framework/src/02_SpreadsheetRaw/SpreadsheetRaw.queue.test.ts (refuses a write queued after it)); blank-row.md names only TableRaw.queueDelete as outside the invariant and leaves out the new tab delete. (packages/framework/docs/architecture/blank-row.md (The invariant)). | ba0b9500-e82d-40b1-b5c7-b6a3023fc857, 5725d2a3-d086-48ee-8652-62ffcdfb8acd |
