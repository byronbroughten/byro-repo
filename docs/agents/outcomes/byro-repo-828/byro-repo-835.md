# byro-repo#835 outcome

Spec: [byro-repo#828](https://github.com/byronbroughten/byro-repo/issues/828)

| Issue | Workflow | Pair | Account | Files changed | Estimate | Peak context | Result | Proposals | Review rounds | Retries | Limit resumes | Duration | Cost (API-equivalent) | Review cost | What review caught | Session ids |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #835 | code | Opus low | 6 | 9 | ~125K | 121K | Fix (resumed implementer) | 0 | 1 | 0 | 0 | 8 min | $1.17 | $1.09 | Fixed: withLandedPlaceholder masks the timestamp with a regex instead of injecting a clock, so the Landed value is never asserted. (runner/src/WrapUp.test.ts:365); Mysterious Name: OutcomeRowFile.landedAt holds the adding commit's date and collides with the row's own landed date. (runner/src/outcomeSummary.ts:15). | 55446a8c-36db-410d-91a1-131b5bd3a1d9 |
