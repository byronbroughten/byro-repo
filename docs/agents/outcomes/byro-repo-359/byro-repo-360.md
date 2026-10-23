# byro-repo#360 outcome

Spec: [byro-repo#359](https://github.com/byronbroughten/byro-repo/issues/359)

| Issue | Pair | Account | Files changed | Peak context | Result | Proposals | Review rounds | Retries | Duration | Cost (API-equivalent) | Triage cost | What review caught | Session ids |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #360 | Opus medium | 1 | 11 | 112K | Triage fix | 1 | 1 | 0 | unrecorded | unrecorded | unrecorded | Fixed: _recordSessions runs before the lease release in finally, so a facts-file throw skips the release and replaces the review's result. (runner/src/SpecRun/SessionReviewer.ts:130); The unpriced-model test now asserts only reviewCostUsd, and nothing checks that implementer-only costUsd comes out unrecorded for an unpriced implementer model. (runner/src/transcriptFacts.test.ts:136). Proposed: Review step sessions are recorded under the implement session's config folder, so if they ran under a different config folder their transcripts can't be found and Review cost and Duration come out unrecorded with no reason given. (runner/src/SpecRun/SessionReviewer.ts:137-139). | 0a627b2d-8853-41eb-98e7-e0e0cabbf609, 2981fb2b-7754-4a0c-b6d4-641248c77ae3, 5cfccd50-3845-41e2-8e05-c5c1ee70d036 |
