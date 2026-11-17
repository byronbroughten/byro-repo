# byro-repo#799 outcome

Spec: [byro-repo#796](https://github.com/byronbroughten/byro-repo/issues/796)

| Issue | Workflow | Pair | Account | Files changed | Estimate | Peak context | Result | Proposals | Review rounds | Retries | Limit resumes | Duration | Cost (API-equivalent) | Review cost | What review caught | Session ids |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #799 | code | Sonnet medium | 5 | 8 | ~122K | 101K | Fix (resumed implementer) | 2 | 1 | 0 | 0 | 5 min | $0.54 | $0.60 | Fixed: `specLabels` holds a `LabelledIssue`, not labels. (runner/src/WrapUp/LogRowCommitter.ts:47). Proposed: The fallback's comment says the ticket Halted its run, but a ticket landed outside a run has no Halt, so a neither-label ticket in a both-labelled spec silently gets `piece`. (runner/src/WrapUp/LogRowCommitter.ts:52-53); `{ ticket, spec: run.spec }` is rebuilt at about 10 sites, a Data Clump and Duplicated Code that recurs across the runner. (HaltRaiser, SpecRunBase, TicketLander, FactsWriter, MasterMerger, TicketChecker call sites). | 55c1d627-db19-493c-820b-35e63a9cc9c9 |
