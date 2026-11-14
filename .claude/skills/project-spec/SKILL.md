---
name: project-spec
description: "Turn the current conversation into a Project: one or more code or piece specs, each a Phase, proposed in one message and filed in blocked-by order on the developer's yes. Invoked as /project-spec <repo> <n> on a held spec, it runs that spec's Phase gate."
argument-hint: "[<repo> <n>]"
disable-model-invocation: true
---

`/project-spec` synthesizes the conversation and your understanding of the codebase into a **Project**: one or more specs, each a **Phase**, filed in blocked-by order. Don't interview the developer: the proposal message (step 4) is the one confirmation, plus the piece fields' one message (step 3) when a piece spec has any left open.

`/project-spec <repo> <n>` on a held spec runs its **Phase gate** instead: [The Phase gate](#the-phase-gate).

The issue tracker and triage label vocabulary should have been provided to you. If not, read `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`.

## 1. Explore

Explore the repo to understand the current state of the codebase, if you haven't already. Use the project's domain glossary vocabulary throughout each spec, and respect ADRs in the area you're touching, and the design.md principles that apply.

## 2. Split the work into specs

**Split work into several specs for a gate (real use could change or cancel what follows) or for size (a spec headed past about 55 user stories or about 25K characters of body)**; the rest of the rule is [`planning.md`'s Phases](../../../docs/agents/planning.md#phases). With neither reason, the Project is one spec.

Each spec has one kind, `code` or `piece`. Never plan a spec of both kinds: mixed work becomes one code spec and one piece spec in the same Project.

For each code spec, sketch the seams at which you're going to test it. Existing seams should be preferred to new ones. Use the highest seam possible. If new seams are needed, propose them at the highest point you can. The fewer seams across the codebase, the better - the ideal number is one.

Name any planned test that would break a [test speed rule](../../../config/docs/code-style/tests.md#test-speed) and warn about it clearly, saying which rule it breaks. The spec's Testing Decisions repeat the warning, so it reaches the ticket implemented from it. The warning needs no approval of its own.

## 3. Fill a piece spec's ten fields

A piece spec follows the Piece rules in the root's `docs/pieces/`: [`rules.md`](../../../docs/pieces/rules.md), [`GLOSSARY.md`](../../../docs/pieces/GLOSSARY.md) and [`grilling.md`](../../../docs/pieces/grilling.md). Use their words (Piece, Deliverable, Section, Supporting Material, Reference) and cite them; never restate them here. Draw each field from the conversation `/grill-piece` ran, in the developer's words where they gave them:

- **Deliverable**: the Google Doc's title and Doc ID.
- **Supporting Material**: each by title and Drive ID, with what it is for. For one too long to read whole, such as a book, list the passages that count by page range, given as PDF pages with the printed pages beside them when they differ, such as `PDF pp. 45–60 (printed 31–46)`.
- **Reader**: who reads the Piece, and what they already know.
- **Style**: the Axes line grilling.md's Formality question gives, then the style overrides, to any sheet: Voice, Craft or academic.
- **Form**: the length limit and its cut order, and the template if there is one. With a limit, the field holds a line of its own, `Length: <n> words`, counted over the body text of every Section with headings left out; a run checks the draft against it.
- **Outline**: the glossary's Outline as the developer approved it at the grill's end. [`docs/pieces/outlining.md`](../../../docs/pieces/outlining.md) says how it is written and how a template in Form fixes its Sections.
- **Facts**: the closed list the Piece may use, with each answer to grilling.md's Your own text question named as given, quoted or with where it lives.
- **Research**, **Final pass** and **Split**: grilling.md's answers to the questions of those names.

Done when every field holds an answer or the developer's waiver. Ask for any field the conversation left open, all in one message, before the proposal; a Drive or Doc ID is always asked for, never guessed.

## 4. Propose the Project

Send one message holding:

- the number of specs, in blocked-by order;
- for each spec, its kind, repo, title, and the reason for the boundary before it (gate or size);
- for each code spec, its test seams and any test speed warnings, so the developer can check they match their expectations;
- for each spec after the first, its `## Phase gate` content.

File nothing until the developer says yes to the proposal. A change they ask for gets a revised proposal, and its yes.

## 5. Write each spec

A code spec uses the code template, a piece spec the piece template. Every spec after the first ends with a `## Phase gate` section, before `## Model fit` when it has one:

<phase-gate-template>

## Phase gate

Split: <gate or size>
Try first: <for a gate only, what to try in real use of the spec before it>

</phase-gate-template>

No spec lists the Project: its order lives in the blocked-by edges.

<code-template>

## Problem Statement

The problem that the user is facing, from the user's perspective. For an enabling spec, say that no operator-visible slice fits.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A LONG, numbered list of user stories. Each user story should be in the format of:

1. As an <actor>, I want a <feature>, so that <benefit>

<user-story-example>
1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending
</user-story-example>

This list of user stories should be extremely extensive and cover all aspects of the feature.

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Do NOT include specific file paths or code snippets. They may end up being outdated very quickly.

Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it within the relevant decision and note briefly that it came from a prototype. Trim to the decision-rich parts, not a working demo, just the important bits.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test (only test external behavior, not implementation details)
- Which modules will be tested
- Prior art for the tests (i.e. similar types of tests in the codebase)
- A warning for each planned test that would break a test speed rule, naming the test and the rule, repeated from the seam step

## Out of Scope

A description of the things that are out of scope for this spec.

## Further Notes

Any further notes about the feature.

## Model fit

<Model> <effort>
<one-line reason>

</code-template>

`## Model fit` is the last section of a code spec meant for one session: a pair line naming one of the pairs in [`planning.md`](../../../docs/agents/planning.md#model-fit), then a one-line reason. A code spec that won't fit one session is still filed, without the section.

A piece spec has no `## Model fit`; its tickets carry the pairs, picked by [`model-fit.md`](../../../docs/agents/model-fit.md). Drive and Doc IDs belong in it: the implementer reads by them.

<piece-template>

## Problem Statement

What the developer needs this Piece for, from their perspective.

## Solution

The Piece, its Deliverable and how the work is staged, from the developer's perspective.

## User Stories

A short numbered list, only as long as the Piece needs: `As <actor>, I want <feature>, so that <benefit>`.

## Deliverable

## Supporting Material

## Reader

## Style

## Form

## Outline

## Facts

## Research

## Final pass

## Split

## Out of Scope

## Further Notes

The Piece is done by the done checks in the root's `docs/pieces/rules.md`.

</piece-template>

## 6. File the specs

Resolve each `<repo>` to `<owner>/<repo>`. In each repo filed to, run `gh label create code -R <owner>/<repo> --force` and `gh label create piece -R <owner>/<repo> --force`: the runner picks the piece Workflow by the `piece` label.

File the specs in order, each body from a scratchpad file with `gh issue create -R <owner>/<repo> --body-file <path>`, labelled with its kind and:

- **The first spec**: `ready-for-agent`.
- **Every later spec**: `needs-triage`, so no run picks it up before its Phase gate, then a blocked-by edge to the spec before it, by [the issue tracker doc's Blocking command](../../../docs/agents/issue-tracker.md).

## 7. Close the chat

End with one line per spec:

- **A held spec**: its Phase gate, `/project-spec <repo> <n>`, run once the spec before it closes.
- **A code spec without `## Model fit`**: recommend `/code-tickets <repo> <n>` for sub-issues; say nothing if the developer has explicitly agreed in the conversation that it becomes tickets.
- **A piece spec**: recommend `/piece-tickets <repo> <n>`.

## The Phase gate

`/project-spec <repo> <n>` reviews a held spec: one labelled `needs-triage` with a `## Phase gate` section. On any other issue, say so and stop. **Every write here needs the developer's yes in this session**; their yes to the Project's proposal doesn't extend to its Phase gates.

1. **Read** the held spec with `npm run issue:read -- <repo> <n> --body`, its `## Phase gate` section included. Find the spec it is blocked by with `gh api repos/<owner>/<repo>/issues/<n>/dependencies/blocked_by`, and read that spec's body and its closing review-list comments, found as [`/judge-findings`' step 1](../../../runner/skills/judge-findings/SKILL.md#1-read-the-list) finds them. Take the developer's notes from the conversation.
2. **Check the held spec's Implementation Decisions against master**: for each, read the code it names and list every decision the landed code contradicts, already fulfils, or names something that no longer exists.
3. **Print the remaining specs**: from the held spec, follow `gh api repos/<owner>/<repo>/issues/<n>/dependencies/blocking` to each spec it blocks, and on down the chain, printing each spec's number, title and kind.
4. **Put Go, Reshape or Drop to the developer** with your recommendation, weighing the Phase gate section's split reason, what to try first, the review lists, the notes and the drift step 2 found.

- **Go**: relabel it with `gh issue edit -R <owner>/<repo> <n> --remove-label needs-triage --add-label ready-for-agent`, then recommend `/code-tickets <repo> <n>` for a code spec without `## Model fit`, or `/piece-tickets <repo> <n>` for a piece spec.
- **Reshape**: edit the body as agreed with `gh issue edit -R <owner>/<repo> <n> --body-file <path>`. When a spec is added or dropped, fix the blocked-by edges so the chain stays one line, filing an added spec the held way of step 6. Then do as for Go.
- **Drop**: close it with `gh issue close -R <owner>/<repo> <n> --reason "not planned" --comment "<why>"` and label it `wontfix`, then offer to drop each later spec in the chain the same way.
