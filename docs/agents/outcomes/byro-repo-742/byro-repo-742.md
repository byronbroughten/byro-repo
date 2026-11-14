# byro-repo#742 outcome

Spec: [byro-repo#742](https://github.com/byronbroughten/byro-repo/issues/742)

| Issue | Workflow | Pair | Account | Files changed | Peak context | Result | Proposals | Review rounds | Retries | Limit resumes | Duration | Cost (API-equivalent) | Review cost | What review caught | Session ids |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #742 | code | Opus medium | 4 | 17 | 158K → 97K | Fix (resumed implementer) | 0 | 1 | 0 | 0 | 22 min | $4.68 | $1.33 | Fixed: The bullet-list map/join is repeated in resumePrompts.ts, resolveRecords.ts and SessionReviewer.ts. (runner/src/stepPrompts/resumePrompts.ts:16); RuleResume.skipSchemaResume is an imperative boolean, and the same fact goes by isSchemaResumed elsewhere. (runner/src/SpecRun/ReviewStepper.ts:65-69, 171); ResolveAttempt's comment no longer covers isSchemaResumed. (runner/src/SpecRun/ReviewStepper.ts:60); The no-resume cases are tested for implement only, not resolve or review. (runner/src/SpecRun.schemaFailures.test.ts:95-110); A crash or limit retry of the schema resume loses its problems prompt. (runner/src/SpecRun/StepLauncher.ts:100-104, retryPromptOf, limitResumeOf). | c56a594f-e264-4d3d-b7c8-0bc64a8e7a46, 08cf72a7-85b9-4c8c-bd2e-da11d7ea4b84, 6bc26848-811f-4fe8-a399-1805885ec490 |
