# byro-repo#820 outcome

Spec: [byro-repo#804](https://github.com/byronbroughten/byro-repo/issues/804)

| Issue | Workflow | Pair | Account | Files changed | Estimate | Peak context | Result | Proposals | Review rounds | Retries | Limit resumes | Duration | Cost (API-equivalent) | Review cost | What review caught | Session ids |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #820 | code | Opus medium | 4 | 12 | ~134K | 145K → 137K | Halted then passed (spec-ambiguity blocker) | 0 | 1 | 0 | 0 | 14 min | $3.64 | $2.93 | Fixed: researchPromptOf repeats the two skill names as literals that researchWords.ts's skillNames also holds. (runner/src/Workflow/piece/pieceWorkflow.ts:211-221); The hand-off table's legend doesn't define the new `inlined` value. (docs/agents/workflows.md:70,101); The inlined /research-piece step 5 still tells the step to read /review-research by path. (.claude/skills/research-piece/SKILL.md:22); The real prompt still carries a read-by-path instruction through /research-piece's step 5. (.claude/skills/research-piece/SKILL.md:22). | 7f93043e-6f8a-450d-829e-d2a24f3f6173, d1881f3f-b601-4113-b0c0-20199d7d250f |
