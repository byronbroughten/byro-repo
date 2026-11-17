# byro-repo#801 outcome

Spec: [byro-repo#796](https://github.com/byronbroughten/byro-repo/issues/796)

| Issue | Workflow | Pair | Account | Files changed | Estimate | Peak context | Result | Proposals | Review rounds | Retries | Limit resumes | Duration | Cost (API-equivalent) | Review cost | What review caught | Session ids |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #801 | code | Opus medium | 5, 3 | 14 | ~122K | 176K | Fix (resumed implementer) | 1 | 1 | 0 | 0 | 15 min | $2.40 | $3.25 | Fixed: The new gap-check helpers pass `sections` around and share nothing with promptText.ts's other helpers. (runner/src/promptText.ts:118-198); The sections repeat the frame's routing and gap-definition rules, so a one-Workflow prompt states each rule twice. (runner/src/Workflow/code/gapCheck.ts:9-11; runner/src/Workflow/piece/gapCheck.ts checks); The header says the gap check runs once a spec's every ticket is closed, which is no longer true in a mixed spec. (runner/src/Workflow/code/gapCheck.ts:1); 'A spec with a piece ticket's gap check runs while…' can be misread. (runner/GLOSSARY.md:142). Proposed: The './gapCheck' export now exports only codeGapCheckSection, and nothing imports it. (runner/package.json:33). | d26c7869-cebd-4194-b80f-39b3ff97c2df |
