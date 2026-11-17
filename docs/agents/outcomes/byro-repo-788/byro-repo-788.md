# byro-repo#788 outcome

Spec: [byro-repo#788](https://github.com/byronbroughten/byro-repo/issues/788)

| Issue | Workflow | Pair | Account | Files changed | Estimate | Peak context | Result | Proposals | Review rounds | Retries | Limit resumes | Duration | Cost (API-equivalent) | Review cost | What review caught | Session ids |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #788 | code | Opus medium | 5, 6 | 12 | ~110K | 139K → 97K | Fix (resumed implementer) | 0 | 1 | 0 | 0 | 33 min | $3.12 | $1.84 | Fixed: `kind` for the holder's kind collides with the attempt's `kind: "taken"`, reads as the hold's own kind, and is `holderKind` in RunBuild. (runner/src/AccountLease.ts:26,36; runner/src/PidLock.ts TakeOptions; runner/src/SpecRun/AccountHold.ts AccountHoldConfig); The run label and holder kind travel together through four types and are copied field by field. (runner/src/PidLock.ts tryTake; TakeOptions, AccountLeaseRequest, AccountHoldConfig, LockHolder). | 30dee396-3a46-45af-b310-acb66289071b, 2b8c5df7-589a-478b-a77c-362c65f63afd |
