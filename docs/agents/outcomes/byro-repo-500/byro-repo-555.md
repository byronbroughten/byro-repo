# byro-repo#555 outcome

Spec: [byro-repo#500](https://github.com/byronbroughten/byro-repo/issues/500)

| Issue | Pair | Account | Files changed | Peak context | Result | Proposals | Review rounds | Retries | Duration | Cost (API-equivalent) | Review cost | What review caught | Session ids |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #555 | Opus medium | 4 | 10 | 121K | Fix (resumed implementer) | 0 | 1 | 0 | 13 min | $3.27 | $4.58 | Fixed: _runRefusalOf repeats _batchMemberRefusalOf's chain of _specRefusalOf then _standaloneRefusalOf. (runner/src/SpecRun/PreflightChecker.ts:137-142); Repo verbs dispatch twice, and the lookup isn't keyed by a finite union. (scripts/runner/run.ts:58 and 233-237); The Launchable and Left out sections are built by duplicated code. (runner/src/SpecRun/StandaloneTicketLister.ts:27-50); _refusedOf returns LeftOutTicket[] but shares its name with PreflightChecker's _refusedOf, which returns a RunResult. (runner/src/SpecRun/StandaloneTicketLister.ts:80). | 6490a6b4-564c-4535-864b-6bfd0ace2629, 9f97ced6-b309-4c6c-9877-8903f064544c |
