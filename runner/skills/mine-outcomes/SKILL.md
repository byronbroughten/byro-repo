---
name: mine-outcomes
description: "Turn a landed spec's outcome-log rows into model-fit and process proposals phrased as changes to named runner knobs, offer /retro on the outlier tickets, then clear the spec's rows. Invoked as /mine-outcomes <repo> #<spec>."
disable-model-invocation: true
---

`/mine-outcomes <repo> #<spec>` reads what a landed spec's tickets cost and how they went, and turns it into proposals, so the outcome log stays short and its lessons are kept as changes. Its words (Pass, Fix, Triage fix, Halt, Propose) are in [`runner/GLOSSARY.md`](../../GLOSSARY.md).

## 1. Read the section

The spec's section is the folder `docs/agents/outcomes/<spec repo>-<spec n>/`, one file per landed ticket, each holding a one-row table ([`docs/agents/model-fit.md`](../../../docs/agents/model-fit.md#outcome-log)). Read every file in it. With no folder, say so and stop.

- Columns: Issue, Pair, Account, Files changed, Peak context, Result, Proposals, Review rounds, Retries, Duration, Cost (API-equivalent), Triage cost, Limit used, What review caught, Session ids. A file written before #297 heads Proposals `Defers`, and one before the #213 addendum calls Triage fix `Handoff fix`. Read both by the new names.
- `unrecorded` is a missing fact. Leave it out of a sum or a median and say how many rows each figure rests on. Never guess one.
- Peak context lists one peak per implementer session, in order: `150K → 90K` is a handoff. A row's **peak sum** adds them.

Read the knobs the proposals will name: `defaultRunKnobs` in [`runner/src/runKnobs.ts`](../../src/runKnobs.ts), laid over by `scripts/runner/runner.config.json`, and the pair criteria in [`model-fit.md`](../../../docs/agents/model-fit.md#criteria-for-each-pair). For each ticket, read its `## Model fit` section with `npm run issue:read -- <repo> <n>`.

## 2. Transcripts

A row's transcripts are the `<session id>.jsonl` files its Session ids name, under `~/.claude/projects/*/` or `~/.claude-swap-backup/sessions/*/projects/*/`. A row is **expired** when none of its listed session files is found. One whose Session ids is `unrecorded` never had any. Name both kinds by issue number. They still count in every aggregate below; only `/retro` needs a transcript.

## 3. Outliers

A row is an outlier when any of these holds. Name every rule it trips:

- Result is `Fix`, `Triage fix` or `Halted then passed (<kind>)`.
- Retries is above 0.
- **Over budget**: its peak sum is above `ticketBudget`. A ticket with a handoff counts, since its peaks are summed.
- **Long or costly for its size**: Duration or Cost per file changed is more than twice the spec's median of that figure.

## 4. Proposals

Make two kinds. Each names the knob, criterion or file it would change, the change, and the rows behind it by issue number:

- **Model-fit boundary**: move a ticket shape from one pair to another in a criterion of `model-fit.md`, or change `triagePair`, `gapCheckPair`, `ticketBudget` or `liveCeiling`. Compare each ticket's pair and its Model fit reason with its Result, peak sum and cost. A pair that passed first try on a shape its criterion puts higher is evidence for moving the boundary down. A cheaper pair that needed a Fix is evidence against.
- **Process**: one in a `/retro` category ([`.claude/skills/retro/SKILL.md`](../../../.claude/skills/retro/SKILL.md): Navigation, Automated checks, Coding standards, Global AGENTS.md, Tool economy, No-ops, Information access), drawn mainly from What review caught. The same kind of catch on two or more tickets is a proposal. Name the knob when one fits, such as `maxTurns.<step>`, `allowedTools.<step>`, `skillNames.review` or `reviewListCadence`. Otherwise name the doc or check to change.

A pattern on one row is not a proposal; leave it to `/retro`.

Report triage's share of cost: the sum of Triage cost over the sum of Cost and Triage cost, on the rows where both are recorded, as a percentage with the row count.

## 5. Present

In one message, give:

1. Triage's share of cost.
2. The proposals, model fit first, each with its knob, change and rows.
3. The outliers, each with the rules it trips. Offer `/retro` on each that has transcripts, naming its session ids.
4. The expired rows and the rows that never had transcripts.

Then ask which proposals to file. File each one the developer picks with `gh issue create -R <owner>/<repo>`, resolving `<repo>` the way [`docs/agents/issue-tracker.md`](../../../docs/agents/issue-tracker.md) does, as a standalone issue whose body links the spec as `<owner>/<repo>#<spec>`. A ticket for an agent ends with the `## Model fit` section [`model-fit.md`](../../../docs/agents/model-fit.md) asks for.

## 6. Clear the section

Only once the developer has seen step 5, and has answered on filing and on `/retro`, ask whether to clear the section. A `/retro` they want first goes ahead of the clearing. Git history keeps the files after that. On a yes:

1. `npm run issue:start -- --session mine-outcomes-<spec repo>-<spec n>`, and work in the workspace it prints.
2. `git rm -r docs/agents/outcomes/<spec repo>-<spec n>`, then commit: `Clear the <spec repo>#<spec n> outcome rows after mining.`
3. `npm run wrap-up -- --session mine-outcomes-<spec repo>-<spec n>`.

On a no, leave the folder; a later run mines it again.
