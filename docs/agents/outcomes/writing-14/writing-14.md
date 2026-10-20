# writing#14 outcome

Spec: [writing#14](https://github.com/byronbroughten/writing/issues/14)

| Issue | Pair | Account | Files changed | Peak context | Result | Proposals | Review rounds | Retries | Duration | Cost (API-equivalent) | Triage cost | Limit used | What review caught | Session ids |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #14 | Opus medium | 1 | 6 | 136K | Fix | 0 | 1 | 0 | 21 min | $2.98 | $0.00 | unrecorded | Spec: a function-word-only longest match made the greedy scan skip copied wording overlapping it ("the end of the lease term" was missed); fixed with a test. Standards: an in-place masking helper, two unused exported types, inline file reading in the command, a repeated masked-words type, a duplicated usage line and allow-file format; all fixed. Not changed: projection asserts in four tests (the rule is draft) and the reuse of `scripts/jev/markdownBlocks.ts` from a sibling folder. | d879c1f7-076c-486b-b3b3-f9ba9ec6c63b |
