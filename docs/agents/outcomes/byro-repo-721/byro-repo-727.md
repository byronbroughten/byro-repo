# byro-repo#727 outcome

Spec: [byro-repo#721](https://github.com/byronbroughten/byro-repo/issues/721)

| Issue | Workflow | Pair | Account | Files changed | Estimate | Peak context | Result | Proposals | Review rounds | Retries | Limit resumes | Duration | Cost (API-equivalent) | Review cost | What review caught | Session ids |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #727 | code | Opus medium | 3 | 8 | ~125K | 137K → 150K | Halted then passed (Split Halt) | 0 | 1 | 0 | 0 | 13 min | $3.79 | $1.78 | Fixed: RunLoop built a second AccountHold and overwrote the one _runOf gives each Run, so two places created the same hold. (runner/src/SpecRun/RunLoop.ts:90,271; runner/src/SpecRun/SpecRunBase.ts:247); The race comment misdescribed a branch that is mostly the plain Limit wait, where ranked is empty. (runner/src/SpecRun/StepLauncher/LimitWaiter.ts:118); movingAccount1()'s stray `to` key was spread into the specRun config, and `to` is a mysterious name. (runner/src/SpecRun.accountLease.test.ts:118,259). | 338c1424-a462-4bba-8fea-799021fe151e, 7d3ec19d-ae2a-4a39-b8ff-7f7257f49b39 |
