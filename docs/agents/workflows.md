# The workflows by Workflow stage

The coding and the piece [Workflows](../../runner/GLOSSARY.md#language), stage by stage: the skills that work each [Workflow stage](../../runner/GLOSSARY.md#language), how each hands off to the next, and the rules docs, formats and machinery that two or more skills or [Steps](../../runner/GLOSSARY.md#language) share, each with its route. The core both Workflows run on is the runner glossary's and [the runner's `src/AGENTS.md`](../../runner/src/AGENTS.md)'s. Beside [the turn-cost rules](#turn-cost-a-workflows-setup-turns), it records what is: a gap it shows is a ticket. Each skill keeps its own rules.

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
   - Code: none.
   - Piece: none.
   - Both: [`/project-spec`](../../.claude/skills/project-spec/SKILL.md), which files a Project's specs and runs each Phase gate.
3. **Tickets**
   - Code: [`/review-code-tickets`](../../.claude/skills/review-code-tickets/SKILL.md).
   - Piece: none.
   - Both: [`/project-tickets`](../../.claude/skills/project-tickets/SKILL.md), which branches on the spec's `code` or `piece` label and files through `npm run issue:file`.
4. **Implementation**
   - Code: [`/runner`](../../runner/skills/runner/SKILL.md), the Supervisor; [`/implement-code`](../../runner/skills/implement-code/SKILL.md); [`tdd`](../../.claude/skills/tdd/SKILL.md) and the [`codebase-design`](../../.claude/skills/codebase-design/SKILL.md) it links; and [`/code-review`](../../.claude/skills/code-review/SKILL.md), the review Step's skill.
   - Piece: [`/implement-piece`](../../runner/skills/implement-piece/SKILL.md) and [`/review-piece`](../../.claude/skills/review-piece/SKILL.md), the review Step's skill; for the Research Stage, [`/research-piece`](../../.claude/skills/research-piece/SKILL.md), [`/review-research`](../../.claude/skills/review-research/SKILL.md) and `/runner`, whose Supervisor settles a one-source Research Halt answer.
   - Both: [`/start-issue`](../../.claude/skills/start-issue/SKILL.md), which follows the skill `issue:start` names.
5. **Judgement**
   - Code: none.
   - Piece: [`piece.md`](../../runner/skills/judge-findings/piece.md), which `/judge-findings` reads for a piece spec; the developer's edit of the Deliverable follows the rerun's push, and [`/close-piece`](../../.claude/skills/close-piece/SKILL.md) closes out the Edit gate after it.
   - Both: [`/judge-findings`](../../runner/skills/judge-findings/SKILL.md).
6. **Process revision**
   - Code: [`/mine-outcomes`](../../runner/skills/mine-outcomes/SKILL.md), [`/retro`](../../.claude/skills/retro/SKILL.md), [`/to-code-style`](../../.claude/skills/to-code-style/SKILL.md).
   - Piece: [`/to-writing-style`](../../.claude/skills/to-writing-style/SKILL.md).
   - Both: [`writing-for-agents`](../../.claude/skills/writing-for-agents/SKILL.md), which `/retro`, `/to-code-style` and `/to-writing-style` call.

[`/handoff`](../../.claude/skills/handoff/SKILL.md) is used in any Workflow stage of either Workflow.

## Each Workflow's Steps

[The runner glossary](../../runner/GLOSSARY.md#language) defines each Step.

- **Code**: the runner's [`Workflow`](../../runner/src/Workflow.ts) module picks the code Workflow, whose code is in [`runner/src/Workflow/code/`](../../runner/src/Workflow/code/); its [`codeWorkflow.ts`](../../runner/src/Workflow/code/codeWorkflow.ts) defines the Steps each ticket goes through, and the runner's `TicketSequencer` runs them. `/code-review` is the review Step's skill, named, with each ticket's checks, where `scripts/runner/runnerConfig.ts` builds the code Workflow, and `/implement-code` is generated from the implement Step's shared body (`runner/src/Workflow/code/implementCodeSkill.ts`), so a change to either reaches both an interactive session and a run.
- **Piece**: the runner's [`pieceWorkflow.ts`](../../runner/src/Workflow/piece/pieceWorkflow.ts) runs a Research ticket's research Step, which follows `/research-piece`'s steps 1–7, the ones it names as shared by both modes, then its quote check, and lands it with no code. Every other piece ticket is a drafting ticket: it runs pull, implement, review (whose prompt carries `/review-piece`'s SKILL.md body), resolve, checks and wrap-up, landing by wrap-up; red checks go to the red-checks Step up to the `retriesPerFailure` run knob's times, then raise a Failure Halt. `/implement-piece` is generated from the implement Step's drafting lines (`runner/src/Workflow/piece/implementPieceSkill.ts`), so a change to either reaches both an interactive session and a run.

## Turn cost: a Workflow's Setup turns

A new Workflow, a new or edited step prompt, and a new or edited Workflow skill check their opening against these rules, so they spend no [Setup turns](../../runner/GLOSSARY.md#language).

- **Cost is summed context, not turn count**, since every model request re-reads the session's context.
- **What the runner or a script can know before a session starts goes into its prompt or a script's output, never into a Setup turn.**
- **A step that follows a skill gets the skill's body inlined, never a Skill call or a read by its path**: `runner/src/stepPrompts/inlinedSkill.ts` reads it from the issue workspace's SKILL.md at launch, so the skill stays the one home of its instructions.
- **A resumed session is told what it already holds; a fresh one isn't told it holds what it never saw.**
- **Calls already decided on go out together, and none is added to fill a batch.**
- **A change that cuts turns is measured before and after**: summed context and read tokens per step, by step kind, from the step logs before it lands against the first run after.
- **A change is reverted when it costs more than it saves**: a batching line, when read tokens rise by more than the summed context it saves.
- **Either result goes into [the estimates](./codebase-priorities/estimates.md) as an `Observed:` line.**

The worked examples:

- **byro-repo#357, `/start-issue`'s opening**: `npm run issue:start` prints whether the session is already in the workspace, its path, and the ticket's Model fit and comments, cutting the opening from six turns to two, or one when already entered.
- **byro-repo#773, the review step's opening**: the code and piece review prompts inline their review skill's body; the code review prompt pins `master` as the fixed point and lists each repo's commits since it (`runner/src/Workflow/code/reviewStep.ts`); a review that resumes the implementer is told it holds the ticket (`heldTicketLinesOf` in `runner/src/promptText.ts`); `runner -- review`'s brief prints the same prompt.
- **byro-repo#773, the piece review's inputs**: the runner writes what `/review-piece` copies word for word, the spec's fields, the Unverified sections, the overlap report and the Style file, before the review launches (`runner/src/Workflow/piece/reviewInputs.ts`), leaving the fact list to the review.
- **byro-repo#773, the batching lines**: the implement body, the piece drafting lines and the resolve text both Workflows share carry "send the reads and greps you've already decided on together in one turn, and don't add a call to fill a batch" (`runner/src/stepPrompts/resolveText.ts`), and `/code-review` and `/review-piece` tell each reviewer to send its opening calls together.

## The hand-off table

"Named" means the skill's own text points to the next skill or Step, so a skill edit can break it; "you invoke it" means the hand-off lives only in the developer's habits.

| Workflow stage | Workflow | Skills | Hands off to | Named by |
| --- | --- | --- | --- | --- |
| Planning | Code | `/wayfinder` | `grilling` with `domain-modeling`, `/prototype` and `/research`, by ticket type | named |
| Planning | Code | `/grill-with-docs`, `/grill-me` | `grilling`, and `domain-modeling` for `/grill-with-docs` | named |
| Planning | Both | any | `/project-spec` | you invoke it |
| Planning | Piece | `/grill-piece` | `grilling`, for its round format | named |
| Planning | Piece | `/grill-piece` | `/project-spec` | named |
| Planning | Piece | `/grill-piece` | `/to-writing-style`, with the calibration differences that hold for every Piece, listed unwritten | named |
| Spec | Both | `/project-spec` | `/project-tickets`, for a spec that fails the ticket split test, as every piece spec does; its Phase gate says which | named, in its chat line |
| Tickets | Code | `/review-code-tickets` | `grilling`, for the spec gaps a review finds | named |
| Tickets | Code | `/review-code-tickets` | `/runner` | you invoke it |
| Tickets | Both | `/project-tickets` | `/project-spec <repo> <n>`, on a held spec with a `## Phase gate`, a source past the spec size line or with a gate, or a Phase split past about 20 tickets | named |
| Tickets | Code | `/project-tickets` | `/review-code-tickets`, at 6 or more drafts, before the breakdown reaches the developer; `grilling`, for the spec gaps it finds | named, read by path |
| Tickets | Both | `/project-tickets` | `/runner` on the spec, or for a piece spec `/implement-piece` on the first ticket | named |
| Tickets | Piece | the Edit gate | `/close-piece` | named, in the gate's body and the run's end message |
| Implementation | Code | `/runner` | `/judge-findings` when a run finishes; an Interactive ticket through `/start-issue`'s steps and the skill `issue:start` names | named |
| Implementation | Code | `/start-issue` | `/implement-code`, when `issue:start` names it | named by `issue:start`, read by path |
| Implementation | Piece | `/start-issue` | `/research-piece`, `/close-piece` or `/implement-piece`, whichever `issue:start` names | named by `issue:start`, read by path |
| Implementation | Code | `/implement-code` | `tdd`, the review Step (`runner -- review`), then wrap-up | named |
| Implementation | Code | `tdd` | `codebase-design` | named |
| Implementation | Piece | `/runner` | `/judge-findings` when a run stops at the judge Step | named |
| Implementation | Piece | `/implement-piece` | `/research-piece` on a Research issue, read as a file since it is user-invoked | named |
| Implementation | Piece | `/implement-piece` | the review Step (`runner -- review`), then wrap-up | named |
| Implementation | Piece | `/research-piece` | `/implement-piece`, when the issue is a Piece | named |
| Implementation | Piece | `/research-piece` | `/review-research` on the draft comment, before posting, read as a file since it is user-invoked | named |
| Implementation | Piece | `/research-piece` | `/runner`'s step 6, on an `another source` answer, read as a file since it is user-invoked | named |
| Implementation | Piece | `/research-piece` | wrap-up (`npm run wrap-up -- <repo> <n> --no-code`), once the developer has answered its wanted facts and proposed Outline edits | named |
| Implementation | Piece | `/runner`, the Supervisor | `/project-tickets`, on an `another source` answer larger than one fact from one Drive file, filed by the developer or, when they ask, by the Supervisor | named; read by path when the Supervisor files it |
| Implementation | Both | `/runner`, the Supervisor | `/project-tickets`, on any ticket or split the developer asks for, its Re-ticket entry for one ticket, read as a file since it is user-invoked | named, read by path |
| Implementation | Piece | the research Step | `/research-piece`'s first seven steps, its `/review-research` pass included, read as a file | named, read by path |
| Implementation | Piece | any | `/review-research`, on a posted Research issue's findings | you invoke it |
| Implementation | Piece | a Research issue's wrap-up | `/implement-piece` on the next ticket | you invoke it |
| Judgement | Code | `/judge-findings` | `/to-code-style` and `/mine-outcomes` when it closes a spec; tickets filed by `/project-tickets`' procedure, read as a file | named |
| Judgement | Code | `/judge-findings` | `/project-spec <repo> <n>`, on a held spec the closed spec blocks | named |
| Judgement | Piece | `/judge-findings`, by its `piece.md` | the runner's rerun (`npm run runner`, or detached through `npm run runner:tmux`), which drafts its filed tickets and pushes; tickets filed by `/project-tickets`' piece branch, read as a file | named |
| Judgement | Piece | the developer's edit | `/close-piece` on the Edit gate | you invoke it |
| Judgement | Piece | `/close-piece` | `/to-writing-style` in pair mode, on the developer's yes, read as a file since it is user-invoked | named |
| Judgement | Piece | `/close-piece` | wrap-up, then `/mine-outcomes` when it closes the spec, or `/judge-findings` on an undecided item | named |
| Judgement | Piece | `/close-piece` | `/project-spec <repo> <n>`, on a held spec the closed spec blocks | named |
| Process revision | Code | `/mine-outcomes` | `/retro`, on outlier tickets | named |
| Process revision | Code | `/retro`, `/to-code-style` | `writing-for-agents` | named |
| Process revision | Piece | `/to-writing-style` | `writing-for-agents`, for a change to `/grill-piece`'s calibration step | named |
| Process revision | Both | `/to-code-style` | `/to-writing-style`, with its prose rulings | named |
| any | Both | the context nudge | a handoff by [`handoffs.md`](./handoffs.md#handoffs) | named, by the hook |

## The shared rules docs

A doc is listed when two or more skills or Steps of either Workflow reach it by one of these routes: **directly** (the skill or Step links it or names it to read), **via a doc** (it links a doc that links or names it), **via an always-on hook** (the read-first gate's code-style and prose-style rows, which fire on any code or prose edit, and the context nudge, which fires for any session near the ticket budget), **via a hook message**, or **via a runner prompt** (the text the runner gives a Step). A doc reached only through the root `AGENTS.md` router, or by one skill or Step, isn't listed.

| Doc | Directly | Indirectly |
| --- | --- | --- |
| [Codebase Priorities](./codebase-priorities.md) | `grilling` (and so `/grill-with-docs`, `/grill-me` and `/wayfinder`'s grilling tickets), `/judge-findings`, `/mine-outcomes`, `/retro`, `/to-code-style` | via `verdicts.md`: `/code-review`, `/implement-code`, the review and resolve Steps |
| [`verdicts.md`](./verdicts.md) | `/code-review`, `/implement-code`, `/implement-piece`, `/judge-findings`, `/review-piece`, `/to-writing-style` (its pair mode) | via runner prompt: the resolve Step; via `/code-review` and `/review-piece`: the review Step |
| [`specs.md`](./specs.md) | `/project-spec`, `/project-tickets` | via `tickets.md`: `/review-code-tickets` |
| [`tickets.md`](./tickets.md) | `/project-spec`, `/project-tickets`, `/review-code-tickets` | via `model-fit.md`: `/mine-outcomes` |
| [`handoffs.md`](./handoffs.md) | `/start-issue`, `/to-code-style` | via always-on hook: the context nudge, for any session |
| [`model-fit.md`](./model-fit.md) | `/mine-outcomes`, `/project-spec`, `/project-tickets` | via `tickets.md`: `/review-code-tickets` |
| The code-style rules: [config's](../../config/docs/code-style.md) and [the framework's](../../packages/framework/docs/code-style.md) | `/retro`, `/to-code-style` | via always-on hook: every code edit, by `/implement-code`, the implement and resolve Steps, and `/judge-findings`' "now" fixes |
| [`prose-style.md`](../prose-style.md) | `/code-review`, `/retro`, `/to-code-style` | via always-on hook: every prose edit |
| [`prose-files.md`](./prose-files.md) | `/to-code-style`, `/to-writing-style` | via always-on hook: every prose edit, through `prose-style.md` |
| [The issue tracker doc](./issue-tracker.md) and [triage labels](./triage-labels.md) | `/wayfinder`, `domain-modeling`, `/project-spec`, `/project-tickets`, `/review-code-tickets`, `/code-review`, `/judge-findings`, `/mine-outcomes`, `/close-piece` | |
| [The git workflow doc](./git-workflow.md) | `/implement-code`, `/judge-findings`, `/mine-outcomes`, `/implement-piece` | via runner prompt: the implement Step; via `rules.md`: `/grill-piece`, `/project-spec`, `/project-tickets`, `/review-piece` |
| [The runner glossary](../../runner/GLOSSARY.md) | `/runner`, `/review-code-tickets`, `/judge-findings`, `/mine-outcomes` | |
| [The guardrails doc](../claude-code-guardrails.md) | `/project-tickets`, `/review-code-tickets`' reviewer, `/retro` | |
| Design docs, ADRs and glossaries | `/project-spec`, `/project-tickets`, `domain-modeling`, `tdd`, `/to-code-style` | |
| Skills read as docs | `/project-tickets` by `/judge-findings` and `/runner`; `/retro`'s categories by `/mine-outcomes`; `grilling`'s format by `/judge-findings`, `/mine-outcomes` and `/retro`; `/judge-findings`' step 1 and `/to-writing-style` by `/close-piece`; `/judge-findings`' step 1 by `/to-writing-style`'s pair mode; `/judge-findings`' step 1 by `/project-spec`'s Phase gate | |
| The Voice and Craft sheets: [`writing-voice.md`](../writing-voice.md) and [`writing-craft.md`](../writing-craft.md) | `/grill-piece`, `/implement-piece`, `/review-piece`, `/to-writing-style` | via `rules.md`: `/project-spec`, `/project-tickets`, `/judge-findings` (its `piece.md`); via runner prompt: the piece implement Step |
| [The academic style sheet](../academic-writing-style.md) | `/grill-piece`, `/review-piece`, `/to-writing-style` | via `rules.md`: `/implement-piece`, the piece implement Step, `/project-spec`, `/project-tickets`, `/judge-findings` (its `piece.md`) |
| [`rules.md`](../pieces/rules.md), the rules for writing any Piece | `/grill-piece`, `/project-spec`, `/project-tickets`, `/implement-piece`, `/review-piece`, `/judge-findings` (its `piece.md`) | via runner prompt: the piece implement Step |
| [The writing glossary](../pieces/GLOSSARY.md) | `/grill-piece`, `/project-spec`, `/project-tickets`, `/review-piece`, `/to-writing-style` (its pair mode), `/judge-findings` (its `piece.md`), `/close-piece` | via `rules.md`: `/implement-piece`, the piece implement Step |
| [`grilling.md`](../pieces/grilling.md) | `/grill-piece`, `/project-spec`, `/to-writing-style` | via `rules.md`: `/project-tickets`, `/implement-piece`, the piece implement Step, `/review-piece` |
| [`outlining.md`](../pieces/outlining.md) | `/grill-piece`, `/project-spec`, `/project-tickets` | via `rules.md`: `/implement-piece`, the piece implement Step, `/review-piece` |
| [`pdf-pages.md`](../pdf-pages.md) | `/grill-piece`, `/project-tickets` (its piece-ticket template), `/research-piece`, `/review-research` | via `rules.md`: `/implement-piece`, the piece implement Step, `/project-spec`, `/review-piece` |
| [`agent-draft.md`](../pieces/agent-draft.md) | `/implement-piece`, `/review-piece`, `/to-writing-style` (its pair mode), `/judge-findings` (its `piece.md`), `/close-piece` | via `rules.md`: `/project-spec`, `/project-tickets`; via runner prompt: the piece implement Step |

Routes that depend on which files a ticket touches (the read-first gate's tier, framework-style and writing rows, nested `AGENTS.md` files, the AGENTS.md cost nudge and the sandbox-failure context) live in [the guardrails doc's hooks section](../claude-code-guardrails.md#the-hooks-and-the-project-agent).

## The shared formats

| Format | Skills and Steps |
| --- | --- |
| `grilling`'s round format | `grilling`, `/project-tickets`, `/review-code-tickets`, `/judge-findings`, `/mine-outcomes`, `/retro`, `/grill-piece` |
| The `## Model fit` section and its read-back ([`tickets.md`](./tickets.md#model-fit)) | `/project-spec`, `/project-tickets`, the tickets `/judge-findings` and `/mine-outcomes` file, `/start-issue`'s check |
| A ticket's `## New dependencies` section | `/project-tickets` writes it; `/implement-code` and the implement Step add only what it names; the wrap-up Step refuses any other new package |
| The review list's `R<n>.<k>` items | the runner posts them; `/judge-findings` and the Supervisor decide them through `runner -- decide`; `/to-writing-style`'s pair mode mines the decided Proposals |
| The numbered 🪤/📝 items | `/to-code-style`, `/to-writing-style` |
| The ten spec fields and the piece spec template | `/grill-piece` settles them, `/project-spec` writes them, `/project-tickets` reads Research, Final pass, Split, Form and Outline, `/review-piece` reads Reader, Outline, Form and Style |
| The piece-ticket template, its Sections named by full heading path | `/project-tickets` writes it, and `/judge-findings` for a larger piece fix; `/implement-piece` drafts only the Sections it names; `/review-piece` scopes to them |
| The piece review axes, `spec`, `standards` and `reader`, each finding with a suggested verdict, and `## Dismissed overlaps` | `/review-piece` reports them, and the piece review Step returns them as its record; `/implement-piece` resolves the ones `runner -- review` prints, as the piece resolve Step does |
| The Research fact list comment: numbered facts, each ending with a locator naming its saved text and page range or heading, quotes optional and verbatim, and a `## Unverified` section outside the fact list | `/research-piece` posts it; `/review-research` checks its draft first; `/review-piece`'s fact list takes its facts outside `## Unverified` when the spec links it; `/implement-piece` drafts from its facts, never its quotes or `## Unverified` |
| The passages folder, `.runner/passages/<repo>-<n>` | `/implement-piece` and the piece implement Step save each passage read; `/review-piece`, the piece review Step and `/judge-findings`' piece "now" fixes read it |
| The Agent draft's path and shape | `/implement-piece`, the pull Step, the piece implement Step and `/judge-findings`' piece "now" fixes write it; `/to-writing-style`'s pair mode diffs it; `/close-piece` compares the Deliverable with it |

## The shared machinery

| Machinery | Skills and Steps |
| --- | --- |
| The issue reader (`npm run issue:read`) with Trusted and Untrusted text | `/runner`, `/review-code-tickets`, `/start-issue` (via `issue:start`), `/implement-code`, `/judge-findings`, `/mine-outcomes`, every agent Step, `/project-tickets`, `/implement-piece`, `/review-piece`, `/research-piece`, `/review-research`, `/close-piece`, `/project-spec`'s Phase gate |
| Issue and session workspaces (`npm run issue:start`, [`git-workflow.md`](./git-workflow.md#a-skills-session-workspace)) | `/start-issue`, `/judge-findings`, `/mine-outcomes`, `/implement-piece`'s issue workspace, `/research-piece`'s session workspace, `/close-piece`'s issue workspace |
| Wrap-up (`npm run wrap-up`) | `/implement-code`, `/judge-findings`, `/mine-outcomes`, the wrap-up Step, `/implement-piece`, `/research-piece`, `/close-piece` |
| `npm run doc:print` | `/implement-piece` reads the Deliverable for its pull; `/close-piece` reads it for the changed Sections; `/to-writing-style`'s pair mode reads it for its diff |
| `runner -- decide` | `/runner`, `/implement-code`, `/implement-piece`, `/judge-findings` |
| `runner -- status` | `/runner` reads a run and, to diagnose, the Run board; `/review-code-tickets` and `/project-tickets`' Re-ticket read what has landed or started |
| `npm run overlap` | `/review-piece` runs it; `/implement-piece` reruns it after a fix; the piece resolve Step reruns it after its Fixes; `/judge-findings` reruns it after a piece "now" fix |
| `npm run pdf:text` and the page-range command in [`pdf-pages.md`](../pdf-pages.md) | `/research-piece` dumps text; `/grill-piece` and `/review-research` count and print pages |
| Sub-issues and native blocking edges | `/project-tickets`, `/judge-findings` and `/runner` set them through `npm run issue:file`; `/review-piece` reads the parent through `gh api`; `/project-spec` sets a held spec's blocked-by edge and its Phase gate walks the chain; `/judge-findings` and `/close-piece` list what a closed spec blocks |
| The gworkspace tools (Drive and Docs) | `/grill-piece`, `/implement-piece`, `/research-piece`, `/runner` on an `another source` answer |
| `npm run verify:quotes` | `/research-piece` and the research Step check the fact list; `/runner` checks an addendum |
| The Outline edits' code (`runner/src/outlineEdits.ts`) | a run applies an answered Research Halt's; `/research-piece` applies the developer's through `npm run outline:apply` |

## Out of scope

[`/inbox`](../../.claude/skills/inbox/SKILL.md), [`/wizard`](../../.claude/skills/wizard/SKILL.md), [`/prompt-scan`](../../.claude/skills/prompt-scan/SKILL.md), [`/pr`](../../.claude/skills/pr/SKILL.md), [`/retarget-after-gen-configs`](../../.claude/skills/retarget-after-gen-configs/SKILL.md) and [`/check-upstream-skills`](../../.claude/skills/check-upstream-skills/SKILL.md).
