# byro-repo#286 outcome

Spec: [byro-repo#283](https://github.com/byronbroughten/byro-repo/issues/283)

| Issue | Pair | Account | Files changed | Peak context | Result | Defers | Review rounds | Retries | Duration | Cost (API-equivalent) | Triage cost | Limit used | What review caught | Session ids |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #286 | unrecorded | unrecorded | 11 | unrecorded | Fix | 0 | 1 | 0 | unrecorded | unrecorded | unrecorded | unrecorded | The spec review found the stamp could be written after a check or an edit changed files mid-run; fixed by checking the repos again after the run, with two tests. The standards review found `commandLabelOf` duplicated across SpecRun, WrapUp and Checks (now one function in failureText.ts) and a no-arg helper that should be a getter (fixed). The developer renamed the `fresh` option to `isFresh`. Noted, not changed: SpecRun's `runCommand` overlaps the new concurrent runner; a checkout missing a clone makes `npm run check` throw instead of running unstamped. | unrecorded |
