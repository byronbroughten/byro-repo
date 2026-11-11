# The workflows by Workflow stage

The coding and the piece [Workflows](../../runner/GLOSSARY.md#language), stage by stage: the skills that work each [Workflow stage](../../runner/GLOSSARY.md#language), how each hands off to the next, and the rules docs, formats and machinery that two or more skills or [Steps](../../runner/GLOSSARY.md#language) share, each with its route. The core both Workflows run on is the runner glossary's and [the runner's `src/AGENTS.md`](../../runner/src/AGENTS.md)'s. This doc records what is, not what should be: a gap it shows is a ticket. Each skill keeps its own rules; follow its link for them.

## Which skills are in scope

A skill is in scope when a Workflow stage of either Workflow calls it or names it as the next step. Lint fails when a skill's `SKILL.md` isn't linked from this map, so a new skill goes in a Workflow stage or the out-of-scope list.

**An edit that adds or removes a link to a doc in this doc's shared tables, from a skill, a hook's message or a runner prompt, updates this doc.**

## The Workflow stages and their skills

The words Piece, Deliverable, Section, Stage and Agent draft are [the writing glossary](../pieces/GLOSSARY.md)'s.

1. **Planning**
   - Code: [`/wayfinder`](../../.claude/skills/wayfinder/SKILL.md), [`/grill-with-docs`](../../.claude/skills/grill-with-docs/SKILL.md), [`/grill-me`](../../.claude/skills/grill-me/SKILL.md), [`domain-modeling`](../../.claude/skills/domain-modeling/SKILL.md), [`/prototype`](../../.claude/skills/prototype/SKILL.md), [`/research`](../../.claude/skills/research/SKILL.md).
   - Piece: [`/grill-piece`](../../.claude/skills/grill-piece/SKILL.md).
   - Both: [`grilling`](../../.claude/skills/grilling/SKILL.md), its round format.
2. **Spec**
   - Code: [`/code-spec`](../../.claude/skills/code-spec/SKILL.md).
   - Piece: [`/piece-spec`](../../.claude/skills/piece-spec/SKILL.md).
   - Both: none.
3. **Tickets**
   - Code: [`/code-tickets`](../../.claude/skills/code-tickets/SKILL.md), [`/review-code-tickets`](../../.claude/skills/review-code-tickets/SKILL.md).
   - Piece: [`/piece-tickets`](../../.claude/skills/piece-tickets/SKILL.md), skipped when the spec needs no Research and its Split is one session.
   - Both: none.
4. **Implementation**
   - Code: [`/runner`](../../runner/skills/runner/SKILL.md), the Supervisor; [`/start-issue`](../../.claude/skills/start-issue/SKILL.md); [`/implement-code`](../../runner/skills/implement-code/SKILL.md); [`tdd`](../../.claude/skills/tdd/SKILL.md) and the [`codebase-design`](../../.claude/skills/codebase-design/SKILL.md) it links; and [`/code-review`](../../.claude/skills/code-review/SKILL.md), the review Step's skill.
   - Piece: [`/implement-piece`](../../runner/skills/implement-piece/SKILL.md) and the [`/review-piece`](../../.claude/skills/review-piece/SKILL.md) it follows; for the Research Stage, [`/research-piece`](../../.claude/skills/research-piece/SKILL.md), [`/review-research`](../../.claude/skills/review-research/SKILL.md) and `/runner`, whose Supervisor settles a one-source Research Halt answer.
   - Both: none.
5. **Judgement**
   - Code: [`/judge-findings`](../../runner/skills/judge-findings/SKILL.md).
   - Piece: no skill. The developer's edit of the Deliverable decides the review's judgement calls, and wrap-up waits for it.
   - Both: none.
6. **Process revision**
   - Code: [`/mine-outcomes`](../../runner/skills/mine-outcomes/SKILL.md), [`/retro`](../../.claude/skills/retro/SKILL.md), [`/to-code-style`](../../.claude/skills/to-code-style/SKILL.md).
   - Piece: [`/to-writing-style`](../../.claude/skills/to-writing-style/SKILL.md).
   - Both: [`writing-for-agents`](../../.claude/skills/writing-for-agents/SKILL.md), which `/retro`, `/to-code-style` and `/to-writing-style` call.

[`/handoff`](../../.claude/skills/handoff/SKILL.md) is used in any Workflow stage of either Workflow.

## Each Workflow's Steps

[The runner glossary](../../runner/GLOSSARY.md#language) defines each Step.

- **Code**: the runner's [`Workflow`](../../runner/src/Workflow.ts) module picks the code Workflow, whose code is in [`runner/src/Workflow/code/`](../../runner/src/Workflow/code/); its [`codeWorkflow.ts`](../../runner/src/Workflow/code/codeWorkflow.ts) defines the Steps each ticket goes through, and the runner's `TicketSequencer` runs them. `/code-review` is the review Step's skill, named, with each ticket's checks, where `scripts/runner/runnerConfig.ts` builds the code Workflow, and `/implement-code` is generated from the implement Step's shared body (`runner/src/Workflow/code/implementCodeSkill.ts`), so a change to either reaches both an interactive session and a run.
- **Piece**: the runner's [`pieceWorkflow.ts`](../../runner/src/Workflow/piece/pieceWorkflow.ts) runs a Research ticket's research Step, which follows `/research-piece`'s steps 1–7, the ones it names as shared by both modes, then its quote check, and lands it with no code. Every other piece ticket is a drafting ticket: it runs pull, implement, review, whose prompt reads `/review-piece` by its path, resolve, then checks, the overlap command and the spec's length limit, and lands by wrap-up; red checks raise a Failure Halt at once, since it has no red-checks Step yet.

## The hand-off table

"Named" means the skill's own text points to the next skill or Step, so a skill edit can break it; "you invoke it" means the hand-off lives only in the developer's habits.

| Workflow stage | Workflow | Skills | Hands off to | Named by |
| --- | --- | --- | --- | --- |
| Planning | Code | `/wayfinder` | `grilling` with `domain-modeling`, `/prototype` and `/research`, by ticket type | named |
| Planning | Code | `/grill-with-docs`, `/grill-me` | `grilling`, and `domain-modeling` for `/grill-with-docs` | named |
| Planning | Code | any | `/code-spec` | you invoke it |
| Planning | Piece | `/grill-piece` | `grilling`, for its round format | named |
| Planning | Piece | `/grill-piece` | `/piece-spec` | named |
| Planning | Piece | `/grill-piece` | `/to-writing-style`, with the calibration differences that hold for every Piece, listed unwritten | named |
| Spec | Code | `/code-spec` | `/code-tickets`, when the spec won't fit one session | named, in its chat line |
| Spec | Piece | `/piece-spec` | `/piece-tickets` when Research is needed or Split names Sections; `/implement-piece` otherwise | named, in its chat line |
| Tickets | Code | `/code-tickets` | `/review-code-tickets`, at 6 or more tickets, before the breakdown reaches the developer | named, read by path |
| Tickets | Code | `/code-tickets`, `/review-code-tickets` | `grilling`, for the spec gaps a review finds | named |
| Tickets | Code | `/code-tickets`, `/review-code-tickets` | `/runner` | you invoke it |
| Tickets | Code | a Phase gate | `/code-tickets` | named, in the gate's body |
| Tickets | Piece | `/piece-tickets` | `/implement-piece` on the first ticket | named |
| Implementation | Code | `/runner` | `/judge-findings` when a run finishes; an Interactive ticket through `/start-issue`'s steps and `/implement-code` | named |
| Implementation | Code | `/start-issue` | `/implement-code` | named |
| Implementation | Code | `/implement-code` | `tdd`, the review Step (`runner -- review`), then wrap-up | named |
| Implementation | Code | `tdd` | `codebase-design` | named |
| Implementation | Piece | `/implement-piece` | `/research-piece` on a Research issue, read as a file since it is user-invoked | named |
| Implementation | Piece | `/implement-piece` | `/review-piece` once drafted, read as a file since it is user-invoked | named |
| Implementation | Piece | `/implement-piece` | wrap-up (`npm run wrap-up -- <repo> <n>`), once the developer has finished editing | named |
| Implementation | Piece | `/research-piece` | `/implement-piece`, when the issue is a Piece | named |
| Implementation | Piece | `/research-piece` | `/review-research` on the draft comment, before posting, read as a file since it is user-invoked | named |
| Implementation | Piece | `/research-piece` | `/runner`'s step 6, on an `another source` answer, read as a file since it is user-invoked | named |
| Implementation | Piece | `/research-piece` | wrap-up (`npm run wrap-up -- <repo> <n> --no-code`), once the developer has answered its wanted facts and proposed Outline edits | named |
| Implementation | Piece | `/runner`, the Supervisor | `/piece-tickets`, through the developer, on an `another source` answer larger than one fact from one Drive file | named |
| Implementation | Piece | the research Step | `/research-piece`'s first seven steps, its `/review-research` pass included, read as a file | named, read by path |
| Implementation | Piece | any | `/review-research`, on a posted Research issue's findings | you invoke it |
| Implementation | Piece | a Research issue's wrap-up | `/implement-piece` on the next ticket | you invoke it |
| Judgement | Code | `/judge-findings` | `/to-code-style` and `/mine-outcomes` when it closes a spec; tickets filed by `/code-tickets`' conventions | named |
| Judgement | Piece | the developer's edit | wrap-up | you invoke it |
| Judgement | Piece | the developer's edit | `/to-writing-style`, on the Piece's Agent draft | you invoke it |
| Process revision | Code | `/mine-outcomes` | `/retro`, on outlier tickets | named |
| Process revision | Code | `/retro`, `/to-code-style` | `writing-for-agents` | named |
| Process revision | Piece | `/to-writing-style` | `writing-for-agents`, for a change to `/grill-piece`'s calibration step | named |
| Process revision | Both | `/to-code-style` | `/to-writing-style`, with its prose rulings | named |
| any | Both | the context nudge | a handoff by [`planning.md`'s Handoffs](./planning.md#handoffs) | named, by the hook |

## The shared rules docs

A doc is listed when two or more skills or Steps of either Workflow reach it by one of these routes: **directly** (the skill or Step links it or names it to read), **via a doc** (it links a doc that links or names it), **via an always-on hook** (the read-first gate's code-style and prose-style rows, which fire on any code or prose edit, and the context nudge, which fires for any session near the ticket budget), **via a hook message**, or **via a runner prompt** (the text the runner gives a Step). A doc reached only through the root `AGENTS.md` router, or by one skill or Step, isn't listed.

| Doc | Directly | Indirectly |
| --- | --- | --- |
| [Codebase Priorities](./codebase-priorities.md) | `grilling` (and so `/grill-with-docs`, `/grill-me` and `/wayfinder`'s grilling tickets), `/judge-findings`, `/mine-outcomes`, `/retro`, `/to-code-style` | via `verdicts.md`: `/code-review`, `/implement-code`, the review and resolve Steps |
| [`verdicts.md`](./verdicts.md) | `/code-review`, `/implement-code`, `/judge-findings`, `/review-piece` | via runner prompt: the resolve Step; via `/code-review` and `/review-piece`: the review Step |
| [`planning.md`](./planning.md) | `/code-spec`, `/code-tickets`, `/review-code-tickets`, `/start-issue`, `/to-code-style`, `/piece-spec` (model fit), `/piece-tickets` (ticket size and model fit) | via always-on hook: the context nudge, for any session |
| [`model-fit.md`](./model-fit.md) | `/mine-outcomes` | via `planning.md`: `/code-spec`, `/code-tickets` |
| The code-style rules: [config's](../../config/docs/code-style.md) and [the framework's](../../packages/framework/docs/code-style.md) | `/retro`, `/to-code-style` | via always-on hook: every code edit, by `/implement-code`, the implement and resolve Steps, and `/judge-findings`' "now" fixes |
| [`prose-style.md`](../prose-style.md) | `/code-review`, `/retro`, `/to-code-style` | via always-on hook: every prose edit |
| [`prose-files.md`](./prose-files.md) | `/to-code-style`, `/to-writing-style` | via always-on hook: every prose edit, through `prose-style.md` |
| [The issue tracker doc](./issue-tracker.md) and [triage labels](./triage-labels.md) | `/wayfinder`, `domain-modeling`, `/code-spec`, `/code-tickets`, `/review-code-tickets`, `/code-review`, `/judge-findings`, `/mine-outcomes` | |
| [The git workflow doc](./git-workflow.md) | `/implement-code`, `/judge-findings`, `/mine-outcomes`, `/implement-piece` | via runner prompt: the implement Step; via `rules.md`: `/grill-piece`, `/piece-spec`, `/piece-tickets`, `/review-piece` |
| [The runner glossary](../../runner/GLOSSARY.md) | `/runner`, `/review-code-tickets`, `/judge-findings`, `/mine-outcomes` | |
| [The guardrails doc](../claude-code-guardrails.md) | `/code-tickets`, `/review-code-tickets`' reviewer, `/retro` | |
| Design docs, ADRs and glossaries | `/code-spec`, `/code-tickets`, `domain-modeling`, `tdd`, `/to-code-style` | |
| Skills read as docs | `/code-tickets`' conventions by `/judge-findings`; `/retro`'s categories by `/mine-outcomes`; `grilling`'s format by `/judge-findings`, `/mine-outcomes` and `/retro` | |
| The Voice and Craft sheets: [`writing-voice.md`](../writing-voice.md) and [`writing-craft.md`](../writing-craft.md) | `/grill-piece`, `/review-piece`, `/to-writing-style` | via `rules.md`: `/implement-piece`, `/piece-spec`, `/piece-tickets`; via runner prompt: the piece implement Step |
| [The academic style sheet](../academic-writing-style.md) | `/grill-piece`, `/review-piece`, `/to-writing-style` | via `rules.md`: `/implement-piece`, the piece implement Step, `/piece-spec`, `/piece-tickets` |
| [`rules.md`](../pieces/rules.md), the rules for writing any Piece | `/grill-piece`, `/piece-spec`, `/piece-tickets`, `/implement-piece`, `/review-piece` | via runner prompt: the piece implement Step |
| [The writing glossary](../pieces/GLOSSARY.md) | `/grill-piece`, `/piece-spec`, `/piece-tickets`, `/review-piece`, `/to-writing-style` (its pair mode) | via `rules.md`: `/implement-piece`, the piece implement Step |
| [`grilling.md`](../pieces/grilling.md) | `/grill-piece`, `/piece-spec`, `/to-writing-style` | via `rules.md`: `/piece-tickets`, `/implement-piece`, the piece implement Step, `/review-piece` |
| [`outlining.md`](../pieces/outlining.md) | `/grill-piece`, `/piece-spec`, `/piece-tickets` | via `rules.md`: `/implement-piece`, the piece implement Step, `/review-piece` |
| [`pdf-pages.md`](../pdf-pages.md) | `/grill-piece`, `/piece-tickets` (its ticket template), `/research-piece`, `/review-research` | via `rules.md`: `/implement-piece`, the piece implement Step, `/piece-spec`, `/review-piece` |
| [`agent-draft.md`](../pieces/agent-draft.md) | `/implement-piece`, `/review-piece`, `/to-writing-style` (its pair mode) | via `rules.md`: `/piece-spec`, `/piece-tickets`; via runner prompt: the piece implement Step |

Routes that depend on which files a ticket touches (the read-first gate's tier, framework-style and writing rows, nested `AGENTS.md` files, the AGENTS.md cost nudge and the sandbox-failure context) live in [the guardrails doc's hooks section](../claude-code-guardrails.md#the-hooks-and-the-project-agent).

## The shared formats

| Format | Skills and Steps |
| --- | --- |
| `grilling`'s round format | `grilling`, `/code-tickets`, `/review-code-tickets`, `/judge-findings`, `/mine-outcomes`, `/retro`, `/grill-piece` |
| The `## Model fit` section and its read-back ([`planning.md`](./planning.md#model-fit)) | `/code-spec`, `/code-tickets`, the tickets `/judge-findings` and `/mine-outcomes` file, `/start-issue`'s check |
| A ticket's `## New dependencies` section | `/code-tickets` writes it; `/implement-code` and the implement Step add only what it names; the wrap-up Step refuses any other new package |
| The review list's `R<n>.<k>` items | the runner posts them; `/judge-findings` and the Supervisor decide them through `runner -- decide` |
| The numbered 🪤/📝 items | `/to-code-style`, `/to-writing-style` |
| The ten spec fields and the piece-spec template | `/grill-piece` settles them, `/piece-spec` writes them, `/piece-tickets` reads Research, Final pass, Split, Form and Outline, `/review-piece` reads Reader, Outline, Form and Style |
| The piece-ticket template, its Sections named by exact heading text | `/piece-tickets` writes it; `/implement-piece` drafts only the Sections it names; `/review-piece` scopes to them |
| The piece review axes, `spec`, `standards` and `reader`, each finding with a suggested verdict, and `## Dismissed overlaps` | `/review-piece` reports them, and the piece review Step returns them as its record; `/implement-piece` fixes the findings suggested as Fix and reports the rest |
| The Research fact list comment: numbered facts, each ending with a locator naming its saved text and page range or heading, quotes optional and verbatim, and a `## Unverified` section outside the fact list | `/research-piece` posts it; `/review-research` checks its draft first; `/review-piece`'s fact list takes its facts outside `## Unverified` when the spec links it; `/implement-piece` drafts from its facts, never its quotes or `## Unverified` |
| The passages folder, `.runner/passages/<repo>-<n>` | `/implement-piece` and the piece implement Step save each passage read; `/review-piece` and the piece review Step read it |
| The model-fit chat line: `/implement-piece <repo> <n>: <Model> <effort> (reason)` from `/piece-spec`, `#n Title: <Model> <effort> (reason)` from `/piece-tickets` | `/piece-spec`, `/piece-tickets` |
| The Agent draft's path and shape | `/implement-piece`, the pull Step and the piece implement Step save it; `/to-writing-style`'s pair mode diffs it |

## The shared machinery

| Machinery | Skills and Steps |
| --- | --- |
| The issue reader (`npm run issue:read`) with Trusted and Untrusted text | `/runner`, `/review-code-tickets`, `/start-issue` (via `issue:start`), `/implement-code`, `/judge-findings`, `/mine-outcomes`, every agent Step, `/piece-tickets`, `/implement-piece`, `/review-piece`, `/research-piece`, `/review-research` |
| Issue and session workspaces (`npm run issue:start`, [`git-workflow.md`](./git-workflow.md#a-skills-session-workspace)) | `/start-issue`, `/judge-findings`, `/mine-outcomes`, `/implement-piece`'s issue workspace, `/research-piece`'s session workspace |
| Wrap-up (`npm run wrap-up`) | `/implement-code`, `/judge-findings`, `/mine-outcomes`, the wrap-up Step, `/implement-piece`, `/research-piece` |
| `runner -- decide` | `/runner`, `/implement-code`, `/judge-findings` |
| `npm run overlap` | `/review-piece` runs it; `/implement-piece` reruns it after a fix |
| `npm run pdf:text` and the page-range command in [`pdf-pages.md`](../pdf-pages.md) | `/research-piece` dumps text; `/grill-piece` and `/review-research` count and print pages |
| Sub-issues and native blocking edges | `/piece-tickets` sets them; `/review-piece` reads the parent through `gh api` |
| The gworkspace tools (Drive and Docs) | `/grill-piece`, `/implement-piece`, `/research-piece`, `/runner` on an `another source` answer |
| `npm run verify:quotes` | `/research-piece` and the research Step check the fact list; `/runner` checks an addendum |
| The Outline edits' code (`runner/src/outlineEdits.ts`) | a run applies an answered Research Halt's; `/research-piece` applies the developer's through `npm run outline:apply` |

## Out of scope

[`/inbox`](../../.claude/skills/inbox/SKILL.md), [`/wizard`](../../.claude/skills/wizard/SKILL.md), [`/prompt-scan`](../../.claude/skills/prompt-scan/SKILL.md), [`/pr`](../../.claude/skills/pr/SKILL.md), [`/retarget-after-gen-configs`](../../.claude/skills/retarget-after-gen-configs/SKILL.md) and [`/check-upstream-skills`](../../.claude/skills/check-upstream-skills/SKILL.md).
