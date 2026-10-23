# byro-repo#341 outcome

Spec: [byro-repo#331](https://github.com/byronbroughten/byro-repo/issues/331)

| Issue | Pair | Account | Files changed | Peak context | Result | Proposals | Review rounds | Retries | Duration | Cost (API-equivalent) | Triage cost | What review caught | Session ids |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #341 | Opus medium | 2 | 4 | 100K | Triage fix | 1 | 1 | 0 | 22 min | $1.56 | $0.00 | Fixed: A gh given by full path anywhere but the first word (xargs, env -i, bash -c, $(…)) is not detected, so a supervising session's gh write is not asked. (.claude/hooks/lib/tiers.ts:62 and :194-200 (hiddenGh / ghWriteOf)); 'Runner steps are never supervisors' is enforced only by the untested `mode === "interactive"` short-circuit in the hook wiring. (.claude/hooks/tierGate.ts:84-85). Proposed: The top-level import of runnerConfig.ts runs git rev-parse and loadRunKnobs on every hook call, and a load-time throw skips runFailOpen and loses every tier decision. (.claude/hooks/tierGate.ts:5-8; .claude/hooks/lib/tiers.ts:88). | afe9c8ea-5aca-42b1-b842-06c1cbea21f0 |
