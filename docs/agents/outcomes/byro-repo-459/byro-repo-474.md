# byro-repo#474 outcome

Spec: [byro-repo#459](https://github.com/byronbroughten/byro-repo/issues/459)

| Issue | Pair | Account | Files changed | Peak context | Result | Proposals | Review rounds | Retries | Duration | Cost (API-equivalent) | Review cost | What review caught | Session ids |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #474 | Opus low | 3 | 34 | 120K | Halted then passed (denied-tool blocker) | 1 | 1 | 0 | 22 min | $2.78 | $2.98 | Fixed: The column-key record type is spelled out twice in transcriptCellsOf. (runner/src/outcomeLog.ts:107-110); recordedOf falls back to an empty-string config folder when no folder holds the transcript. (runner/src/outcomeBackfill.ts:64-67); Sessions with no recorded account were dropped, so summed facts were written as if complete. (runner/src/outcomeBackfill.ts:39-41). Proposed: The three runs' rows were not rewritten or committed; only the chore landed. (docs/agents/outcomes/{byro-repo-387,sheets-framework-166,byro-repo-445}). | 35da11b8-7180-4632-bf76-d0386cf803a3, 1dee6202-85e9-42aa-b6ef-c9be6458e37a |
