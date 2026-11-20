# The workflows by Workflow stage

The coding and the piece [Workflows](../../runner/GLOSSARY.md#language), stage by stage: the skills that work each [Workflow stage](../../runner/GLOSSARY.md#language), how each hands off to the next, and the rules docs, formats and machinery that two or more skills or [Steps](../../runner/GLOSSARY.md#language) share, each with its route. The core both Workflows run on is the runner glossary's and [the runner's `src/AGENTS.md`](../../runner/src/AGENTS.md)'s. Beside [the cross-Workflow rule](#a-change-to-one-workflow) and [the turn-cost rules](#turn-cost-a-workflows-setup-turns), it records what is: a gap it shows is a ticket. Each skill keeps its own rules.

## A change to one Workflow

**When a change to one Workflow is decided, consider whether an analogous change would improve each other Workflow, and either make it or say why it doesn't apply**; borrowing improvements across Workflows is encouraged.

## Which skills are in scope

A skill is in scope when a Workflow stage of either Workflow calls it or names it as the next step. Lint fails when a skill's `SKILL.md` isn't linked from this map, so a new skill goes in a Workflow stage or the out-of-scope list.

**An edit that adds or removes a link to a doc in this doc's shared tables, from a skill, a hook's message or a runner prompt, updates this doc.**

## The Workflow stages and their skills

The words Piece, Deliverable, Section, Stage and Agent draft are [the writing glossary](../pieces/GLOSSARY.md)'s.

1. **Planning**
   - Code: [`/wayfinder`](../../.claude/skills/wayfinder/SKILL.md), [`domain-modeling`](../../.claude/skills/domain-modeling/SKILL.md), [`/prototype`](../../.claude/skills/prototype/SKILL.md), [`/research`](../../.claude/skills/research/SKILL.md).
   - Piece: none.
   - Both: [`/plan-project`](../../.claude/skills/plan-project/SKILL.md), which starts every planning session and branches by Workflow, `code.md` or `piece.md`; [`grilling`](../../.claude/skills/grilling/SKILL.md), its round format.
2. **Spec**
   - Code: none.
   - Piece: none.
   - Both: [`/project-spec`](../../.claude/skills/project-spec/SKILL.md), which files a Project's specs and runs each Phase gate.
3. **Tickets**
   - Code: none.
   - Piece: none.
   - Both: [`/project-tickets`](../../.claude/skills/project-tickets/SKILL.md), which branches on the spec's `code` or `piece` label, each ticket of a mixed spec, labelled both, taking its own kind's branch, and files through `npm run issue:file`; [`/review-project-tickets`](../../.claude/skills/review-project-tickets/SKILL.md), which checks a code or piece ticket by its Workflow's causes.
4. **Implementation**
   - Code: [`/runner`](../../runner/skills/runner/SKILL.md), the Supervisor; [`/implement-code`](../../runner/skills/implement-code/SKILL.md); [`tdd`](../../.claude/skills/tdd/SKILL.md) and the [`codebase-design`](../../.claude/skills/codebase-design/SKILL.md) it links; and [`/code-review`](../../.claude/skills/code-review/SKILL.md), the review Step's skill.
   - Piece: [`/implement-piece`](../../runner/skills/implement-piece/SKILL.md) and [`/review-piece`](../../.claude/skills/review-piece/SKILL.md), the review Step's skill; for the Research Stage, [`/research-piece`](../../.claude/skills/research-piece/SKILL.md), [`/review-research`](../../.claude/skills/review-research/SKILL.md) and `/runner`, whose Supervisor settles a one-source Research Halt answer.
   - Both: [`/start-issue`](../../.claude/skills/start-issue/SKILL.md), which follows the skill `issue:start` names.
5. **Judgement**
   - Code: none.
   - Piece: [`piece.md`](../../runner/skills/judge-findings/piece.md), which `/judge-findings` reads for a piece spec; the developer's edit of the Deliverable follows the rerun's push, and `/close-project`'s [`piece.md`](../../.claude/skills/close-project/piece.md) closes out the Edit gate after it.
   - Both: [`/judge-findings`](../../runner/skills/judge-findings/SKILL.md); [`/close-project`](../../.claude/skills/close-project/SKILL.md), which closes out any parent once its sub-issues are closed.
6. **Process revision**
   - Code: none.
   - Piece: none.
   - Both: [`/revise-workflows`](../../.claude/skills/revise-workflows/SKILL.md), which mines a session, pairs a Piece's Agent draft with its edited Deliverable or triages the Friction notes, and branches by Workflow, `code.md` or `piece.md`; [`/note-friction`](../../.claude/skills/note-friction/SKILL.md), which records one Friction note.

[`/handoff`](../../.claude/skills/handoff/SKILL.md) is used in any Workflow stage of either Workflow, and [`writing-for-agents`](../../.claude/skills/writing-for-agents/SKILL.md) wherever a skill calls it, as `/revise-workflows` does.

The [Primers](../../runner/GLOSSARY.md), each loading its rule before the action it names, are used in any Workflow stage of either Workflow: [`file-issue`](../../.claude/skills/file-issue/SKILL.md), [`code-style`](../../.claude/skills/code-style/SKILL.md), [`prose-style`](../../.claude/skills/prose-style/SKILL.md) and [`writing`](../../.claude/skills/writing/SKILL.md).

## Each Workflow's Steps

[The runner glossary](../../runner/GLOSSARY.md#language) defines each Step.

- **Code**: the runner's [`Workflow`](../../runner/src/Workflow.ts) module picks the code Workflow, whose code is in [`runner/src/Workflow/code/`](../../runner/src/Workflow/code/); its [`codeWorkflow.ts`](../../runner/src/Workflow/code/codeWorkflow.ts) defines the Steps each ticket goes through, and the runner's `TicketSequencer` runs them. `/code-review` is the review Step's skill, named, with each ticket's checks, where `scripts/runner/runnerConfig.ts` builds the code Workflow, and `/implement-code` is generated from the implement Step's shared body (`runner/src/Workflow/code/implementCodeSkill.ts`), so a change to either reaches both an interactive session and a run.
- **Piece**: the runner's [`pieceWorkflow.ts`](../../runner/src/Workflow/piece/pieceWorkflow.ts) runs a Research ticket's research Step, which follows `/research-piece`'s steps 1–7, the ones it names as shared by both modes (its prompt carries `/research-piece`'s and `/review-research`'s SKILL.md bodies), then its quote check, and lands it with no code. Every other piece ticket is a drafting ticket: it runs pull, implement, review (whose prompt carries `/review-piece`'s SKILL.md body), resolve, checks and wrap-up, landing by wrap-up; red checks go to the red-checks Step up to the `retriesPerFailure` run knob's times, then raise a Failure Halt. `/implement-piece` is generated from the implement Step's drafting lines (`runner/src/Workflow/piece/implementPieceSkill.ts`), so a change to either reaches both an interactive session and a run.

## Turn cost: a Workflow's Setup turns

A new Workflow, a new or edited step prompt, and a new or edited Workflow skill check their opening against these rules, so they spend no [Setup turns](../../runner/GLOSSARY.md#language).

- **Cost is summed context, not turn count**, since every model request re-reads the session's context.
- **What the runner or a script can know before a session starts goes into its prompt or a script's output, never into a Setup turn.**
- **A step that follows a skill gets the skill's body inlined, never a Skill call or a read by its path**: `runner/src/stepPrompts/inlinedSkill.ts` reads it from the issue workspace's SKILL.md at launch, so the skill stays the one home of its instructions.
- **A resumed session is told what it already holds; a fresh one isn't told it holds what it never saw.**
- **Calls already decided on go out together, and none is added to fill a batch.**
- **A change that replaces Setup turns shows its output's size on a real case against the turns it replaces.**
- **A skill that gains a command loses the text that sent the agent the old way.**
- **A skill gets a command by injection when the command is a read.**
- **A command's output says what it holds.**

The worked examples:

- **byro-repo#357, `/start-issue`'s opening**: `npm run issue:start` prints whether the session is already in the workspace, its path, and the ticket's Model fit and comments, cutting the opening from six turns to two, or one when already entered.
- **byro-repo#773, the review step's opening**: the code and piece review prompts inline their review skill's body; the code review prompt pins `master` as the fixed point and lists each repo's commits since it (`runner/src/Workflow/code/reviewStep.ts`); a review that resumes the implementer is told it holds the ticket (`heldTicketLinesOf` in `runner/src/promptText.ts`); `runner -- review`'s brief prints the same prompt. Measured: the code review step saved 182.5K a ticket against reviews that already resumed the implementer ([the estimates' Steps](./codebase-priorities/estimates.md#steps)).
- **byro-repo#773, the piece review's inputs**: the runner writes what `/review-piece` copies word for word, the spec's fields, the Unverified sections, the overlap report and the Style file, before the review launches (`runner/src/Workflow/piece/reviewInputs.ts`), leaving the fact list to the review.
- **byro-repo#773, the batching lines**: the implement body, the piece drafting lines and the resolve text both Workflows share carry "send the reads and greps you've already decided on together in one turn, and don't add a call to fill a batch" (`runner/src/stepPrompts/resolveText.ts`), and `/code-review` and `/review-piece` tell each reviewer to send its opening calls together. Measured, the line is kept on all three, code's resolve on the developer's call; piece had no run to measure ([the estimates' Steps](./codebase-priorities/estimates.md#steps)).

## The hand-off table

"Named" means the skill's own text points to the next skill or Step, so a skill edit can break it; "you invoke it" means the hand-off lives only in the developer's habits; "inlined" means the runner carries the skill's body in the Step's prompt, so a skill edit reaches it with no pointer to break.

| Workflow stage | Workflow | Skills | Hands off to | Named by |
| --- | --- | --- | --- | --- |
| Planning | Code | `/wayfinder` | `grilling` with `domain-modeling`, `/prototype` and `/research`, by ticket type | named |
| Planning | Code | `/plan-project`, by its `code.md` | `grilling` and `domain-modeling` | named |
| Planning | Piece | `/plan-project`, by its `piece.md` | `grilling`, for its round format | named |
| Planning | Piece | `/plan-project`, by its `piece.md` | `/revise-workflows piece`, with the calibration differences that hold for every Piece, listed unwritten | named |
| Planning | Both | `/plan-project` | `/project-spec`, naming the repo or repos | named |
| Planning | Both | any other | `/project-spec` | you invoke it |
| Spec | Both | `/project-spec` | `/project-tickets`, for a spec that fails the ticket split test, as every piece or mixed spec does; its Phase gate says which | named, in its chat line |
| Tickets | Both | `/review-project-tickets` | `grilling`, for the spec gaps a review finds | named |
| Tickets | Both | `/review-project-tickets` | `/runner` | you invoke it |
| Tickets | Both | `/project-tickets` | `/project-spec <repo> <n>`, on a held spec with a `## Phase gate`, a source past the spec size line or with a gate, or a Phase split past about 20 tickets | named |
| Tickets | Both | `/project-tickets` | `/review-project-tickets`, at 6 or more code drafts or on any piece draft set, before the breakdown reaches the developer; `grilling`, for the spec gaps it finds | named, read by path |
| Tickets | Both | `/project-tickets` | `/runner` on the spec, or for a piece spec `/implement-piece` on the first ticket | named |
| Tickets | Piece | the Edit gate | `/close-project <repo> <spec>` | named, in the gate's body, the run's end message and `issue:start`'s `Skill:` line |
| Implementation | Code | `/runner` | `/judge-findings` when a run finishes; an Interactive ticket through `/start-issue`'s steps and the skill `issue:start` names | named |
| Implementation | Code | `/start-issue` | `/implement-code`, when `issue:start` names it | named by `issue:start`, read by path |
| Implementation | Piece | `/start-issue` | `/research-piece`, `/close-project` or `/implement-piece`, whichever `issue:start` names | named by `issue:start`, read by path |
| Implementation | Code | `/implement-code` | `tdd`, the review Step (`runner -- review`), then wrap-up; `/close-project`'s shared close on each parent its report announced, read as a file since it is user-invoked | named, read by path |
| Implementation | Code | `tdd` | `codebase-design` | named |
| Implementation | Piece | `/runner` | `/judge-findings` when a run stops at the judge Step | named |
| Implementation | Piece | `/implement-piece` | `/research-piece` on a Research issue, read as a file since it is user-invoked | named |
| Implementation | Piece | `/implement-piece` | the review Step (`runner -- review`), then wrap-up; `/close-project`'s shared close on each parent its report announced, read as a file since it is user-invoked | named, read by path |
| Implementation | Piece | `/research-piece` | `/implement-piece`, when the issue is a Piece | named |
| Implementation | Piece | `/research-piece` | `/review-research` on the draft comment, before posting, read as a file since it is user-invoked | named |
| Implementation | Piece | `/research-piece` | `/runner`'s step 6, on an `another source` answer, read as a file since it is user-invoked | named |
| Implementation | Piece | `/research-piece` | wrap-up (`npm run wrap-up -- <repo> <n> --no-code`), once the developer has answered its wanted facts and proposed Outline edits | named |
| Implementation | Piece | `/runner`, the Supervisor | `/project-tickets`, on an `another source` answer larger than one fact from one Drive file, filed by the developer or, when they ask, by the Supervisor | named; read by path when the Supervisor files it |
| Implementation | Both | `/runner`, the Supervisor | `/project-tickets`, on any ticket or split the developer asks for, its Re-ticket entry for one ticket, read as a file since it is user-invoked | named, read by path |
| Implementation | Piece | the research Step | `/research-piece`'s first seven steps, its `/review-research` pass included, both bodies carried in its prompt | inlined |
| Implementation | Piece | any | `/review-research`, on a posted Research issue's findings | you invoke it |
| Implementation | Piece | a Research issue's wrap-up | `/implement-piece` on the next ticket | you invoke it |
| Judgement | Code | `/judge-findings` | `/close-project`'s shared close when it closes a spec, read as a file since it is user-invoked; tickets filed by `/project-tickets`' procedure, read as a file | named, read by path |
| Judgement | Code | `/judge-findings` | `/project-spec <repo> <n>`, on a held spec the closed spec blocks | named |
| Judgement | Piece | `/judge-findings`, by its `piece.md` | the runner's rerun (`npm run runner`, or detached through `npm run runner:tmux`), which drafts its filed tickets and pushes; tickets filed by `/project-tickets`' piece branch, read as a file | named |
| Judgement | Piece | the developer's edit | `/close-project` on the spec | you invoke it |
| Judgement | Piece | the Edit gate, in `/close-project`'s `piece.md` | `/revise-workflows`' pair mode, on the developer's yes, read as a file since it is user-invoked; then the gate's wrap-up | named, read by path |
| Judgement | Both | wrap-up, on a parent with every sub-issue closed | `/close-project <repo> <p>` | named, in wrap-up's parent line |
| Judgement | Both | the Close-out of `/implement-code` and `/implement-piece`, on a ready parent their report didn't announce | `/close-project <repo> <p>` | named |
| Judgement | Both | `/close-project` | `/judge-findings` on an undecided item; `/close-project` on a ready parent its brief didn't announce | named |
| Judgement | Both | `/close-project` | `/revise-workflows log`, its last line, when 20 or more Friction notes are open | named, count-gated |
| Judgement | Both | `/close-project` | `/project-spec <repo> <n>`, on a held spec the closed spec blocks | named |
| Process revision | Both | `/revise-workflows` | `writing-for-agents`, before an AGENTS.md or skill line | named |
| Process revision | Both | `/revise-workflows` | `/note-friction`'s fields, for each candidate answered "file", read as a file | named, read by path |
| any | Both | the context nudge | a handoff by [`handoffs.md`](./handoffs.md#handoffs) | named, by the hook |

## The shared rules docs

A doc is listed when two or more skills or Steps of either Workflow reach it by one of these routes: **directly** (the skill or Step links it or names it to read), **via a doc** (it links a doc that links or names it), **via an always-on hook** (the read-first gate's code-style and prose-style rows, which fire on any code or prose edit, and the context nudge, which fires for any session near the ticket budget), **via a hook message**, or **via a runner prompt** (the text the runner gives a Step). A doc reached only through the root `AGENTS.md` router, or by one skill or Step, isn't listed.

| Doc | Directly | Indirectly |
| --- | --- | --- |
| [Codebase Priorities](./codebase-priorities.md) | `grilling` (and so `/plan-project` and `/wayfinder`'s grilling tickets), `/judge-findings`, `/revise-workflows` | via `verdicts.md`: `/code-review`, `/implement-code`, the review and resolve Steps |
| [`verdicts.md`](./verdicts.md) | `/code-review`, `/implement-code`, `/implement-piece`, `/judge-findings`, `/review-piece`, `/revise-workflows` (its pair mode) | via runner prompt: the resolve Step; via `/code-review` and `/review-piece`: the review Step |
| [`specs.md`](./specs.md) | `/project-spec`, `/project-tickets`, `/review-project-tickets` | |
| [`delegation.md`](./delegation.md) | `/revise-workflows` (its log mode) | via `specs.md`: `/project-spec`, `/project-tickets`, `/review-project-tickets`; via `git-workflow.md`: `/implement-code`, `/judge-findings`, `/implement-piece`, the implement Step; via `planning.md`: `/plan-project` |
| [`tickets.md`](./tickets.md) | `/project-spec`, `/project-tickets`, `/review-project-tickets`, `file-issue` | |
| [`handoffs.md`](./handoffs.md) | `/start-issue`, `/revise-workflows` | via always-on hook: the context nudge, for any session |
| [`model-fit.md`](./model-fit.md) | `/project-spec`, `/project-tickets` | via `tickets.md`: `/review-project-tickets` |
| The code-style rules: [config's](../../config/docs/code-style.md) and [the framework's](../../packages/framework/docs/code-style.md) | `/revise-workflows`, `code-style` | via always-on hook: every code edit, by `/implement-code`, the implement and resolve Steps, and `/judge-findings`' "now" fixes |
| [`prose-style.md`](../prose-style.md) | `/code-review`, `/revise-workflows`, `prose-style` | via always-on hook: every prose edit |
| [`prose-files.md`](./prose-files.md) | `/revise-workflows` | via always-on hook: every prose edit, through `prose-style.md` |
| [The issue tracker doc](./issue-tracker.md) and [triage labels](./triage-labels.md) | `/wayfinder`, `domain-modeling`, `/project-spec`, `/project-tickets`, `/review-project-tickets`, `/code-review`, `/judge-findings`, `/close-project`, `file-issue` | |
| [The git workflow doc](./git-workflow.md) | `/implement-code`, `/judge-findings`, `/implement-piece` | via runner prompt: the implement Step; via `rules.md`: `/plan-project`, `/project-spec`, `/project-tickets`, `/review-piece` |
| [The runner glossary](../../runner/GLOSSARY.md) | `/runner`, `/review-project-tickets`, `/judge-findings`, `/revise-workflows` | |
| [The guardrails doc](../claude-code-guardrails.md) | `/project-tickets`, `/review-project-tickets`' reviewer | |
| Design docs, ADRs and glossaries | `/project-spec`, `/project-tickets`, `domain-modeling`, `tdd` | |
| Skills read as docs | `/project-tickets` by `/judge-findings` and `/runner`; `grilling`'s format by `/judge-findings` and `/revise-workflows`; `/note-friction`'s fields by `/revise-workflows`; `/judge-findings`' step 5 by `/close-project`, and `/revise-workflows`' pair mode by its `piece.md`; `/plan-project`'s `piece.md` step 4 by `/revise-workflows`' `piece.md`; `/close-project`'s steps 1 and 3 to 5 by `/judge-findings`, and its steps 1 to 5 by `/implement-code` and `/implement-piece`; `/judge-findings`' step 1 by `/revise-workflows`' pair mode; `/judge-findings`' step 1 by `/project-spec`'s Phase gate; `/project-tickets` and `/project-spec` by `file-issue` | |
| The Voice and Craft sheets: [`writing-voice.md`](../writing-voice.md) and [`writing-craft.md`](../writing-craft.md) | `/plan-project`, `/implement-piece`, `/review-piece`, `/revise-workflows`, `writing` | via `rules.md`: `/project-spec`, `/project-tickets`, `/judge-findings` (its `piece.md`); via runner prompt: the piece implement Step |
| [The academic style sheet](../academic-writing-style.md) | `/plan-project`, `/review-piece`, `/revise-workflows`, `writing` | via `rules.md`: `/implement-piece`, the piece implement Step, `/project-spec`, `/project-tickets`, `/judge-findings` (its `piece.md`) |
| [`rules.md`](../pieces/rules.md), the rules for writing any Piece | `/plan-project`, `/project-spec`, `/project-tickets`, `/implement-piece`, `/review-piece`, `/judge-findings` (its `piece.md`) | via runner prompt: the piece implement Step |
| [The writing glossary](../pieces/GLOSSARY.md) | `/plan-project`, `/project-spec`, `/project-tickets`, `/review-piece`, `/revise-workflows` (its pair mode), `/judge-findings` (its `piece.md`), `/close-project` (its `piece.md`) | via `rules.md`: `/implement-piece`, the piece implement Step |
| [`grilling.md`](../pieces/grilling.md) | `/plan-project`, `/project-spec`, `/revise-workflows` | via `rules.md`: `/project-tickets`, `/implement-piece`, the piece implement Step, `/review-piece` |
| [`outlining.md`](../pieces/outlining.md) | `/plan-project`, `/project-spec`, `/project-tickets` | via `rules.md`: `/implement-piece`, the piece implement Step, `/review-piece` |
| [`pdf-pages.md`](../pdf-pages.md) | `/plan-project`, `/project-tickets` (its piece-ticket template), `/research-piece`, `/review-research` | via `rules.md`: `/implement-piece`, the piece implement Step, `/project-spec`, `/review-piece` |
| [`agent-draft.md`](../pieces/agent-draft.md) | `/implement-piece`, `/review-piece`, `/review-project-tickets`' reviewer, `/revise-workflows` (its pair mode), `/judge-findings` (its `piece.md`), `/close-project` (its `piece.md`) | via `rules.md`: `/project-spec`, `/project-tickets`; via runner prompt: the piece implement Step |
| [`style-file.md`](../pieces/style-file.md) | `/review-piece` | via runner prompt: the piece review Step, which carries `/review-piece`'s body |

Routes that depend on which files a ticket touches (the read-first gate's tier, framework-style and writing rows, nested `AGENTS.md` files, the AGENTS.md cost nudge and the sandbox-failure context) live in [the guardrails doc's hooks section](../claude-code-guardrails.md#the-hooks-and-the-project-agent).

## The shared formats

| Format | Skills and Steps |
| --- | --- |
| `grilling`'s round format | `grilling`, `/project-tickets`, `/review-project-tickets`, `/judge-findings`, `/plan-project`, `/revise-workflows`, each of whose questions takes yes, no or file |
| A Friction note's file: its fields, id and path in the primary root's `.runner/friction/` ([`frictionNotes.ts`](../../runner/src/frictionNotes.ts)) | `/note-friction` and `runner -- decide` write it; `/revise-workflows` reads it in log mode, sets its status and writes one for each "file" answer; `npm run logs` syncs and restores it |
| The `## Model fit` section and its read-back ([`tickets.md`](./tickets.md#model-fit)) | `/project-spec`, `/project-tickets`, the tickets `/judge-findings` files, `/start-issue`'s check |
| The findings file, `repo-explorer`'s report saved verbatim as `<scratchpad>/findings.md` ([`specs.md`'s Exploring](./specs.md#exploring)) | `/project-spec` and `/project-tickets` save it; `/review-project-tickets` hands it to each reviewer |
| A ticket's `## New dependencies` section | `/project-tickets` writes it; `/implement-code` and the implement Step add only what it names; the wrap-up Step refuses any other new package |
| The review list's `R<n>.<k>` items | the runner posts them; `/judge-findings` and the Supervisor decide them through `runner -- decide`; `/revise-workflows`' pair mode mines the decided Proposals |
| The ten spec fields and the piece spec template | `/plan-project` settles them, `/project-spec` writes them, `/project-tickets` reads Research, Final pass, Form, Outline and Images, the Solution's developer-only steps, and a `## Split` an older spec holds as a suggestion, `/review-piece` reads Reader, Outline, Form, Style and Images; Images is also read by `/implement-piece` and the piece implement Step, which make or download each image, by the piece review Step's inputs, and by the piece Workflow's source targets, which add its Drive file IDs |
| The piece-ticket template, its Sections named by full heading path | `/project-tickets` writes it, and `/judge-findings` for a larger piece fix; `/implement-piece` drafts only the Sections it names; `/review-piece` scopes to them |
| The piece review axes, `spec`, `standards` and `reader`, each finding with a suggested verdict, and `## Dismissed overlaps` | `/review-piece` reports them, and the piece review Step returns them as its record; `/implement-piece` resolves the ones `runner -- review` prints, as the piece resolve Step does |
| The Research fact list comment: numbered facts, each ending with a locator naming its saved text and page range or heading, quotes optional and verbatim, and a `## Unverified` section outside the fact list | `/research-piece` posts it; `/review-research` checks its draft first; `/review-piece`'s fact list takes its facts outside `## Unverified` when the spec links it; `/implement-piece` drafts from its facts, never its quotes or `## Unverified` |
| The passages folder, `.runner/passages/<repo>-<n>` | `/implement-piece` and the piece implement Step save each passage read; `/review-piece`, the piece review Step and `/judge-findings`' piece "now" fixes read it |
| The Agent draft's path and shape | `/implement-piece`, the pull Step, the piece implement Step and `/judge-findings`' piece "now" fixes write it; `/revise-workflows`' pair mode diffs it; `/close-project`'s `piece.md` compares the Deliverable with it |
| The image folder, `writing/agent-drafts/<n>/` beside the Agent draft ([`agent-draft.md`](../pieces/agent-draft.md#file-format)) | `/implement-piece` and the piece implement Step write each image there; the piece resolve and red-checks Steps may change only the agent's own images; `/review-piece` and the piece review Step look at each image file; `/project-tickets`' Edit gate lists each file by path |
| The Image placeholder, `\[Image <n>: <file or facts>\]` ([`agent-draft.md`](../pieces/agent-draft.md#file-format)) | `/implement-piece` and the piece implement Step write it; the piece checks' length check leaves it out; the piece review Step's inputs list the files it names; `/review-piece` checks it against its Images entry; the push writes it into the Deliverable; `/project-tickets`' Edit gate names the placeholder each image file replaces |

**The images are the piece Workflow's alone**: the code Workflow has none, so the Images field, the image folder and the Image placeholder have no code analogue. Nor does `/review-piece`'s report of gaps between a Piece's parts carry over: a code comment that accounts for why two parts differ is encouraged at its site, and one resting on an outside constraint is already a Propose `decision` under [`verdicts.md`](./verdicts.md)'s keep rule.

## The shared machinery

| Machinery | Skills and Steps |
| --- | --- |
| The issue reader (`npm run issue:read`) with Trusted and Untrusted text | `/runner`, `/review-project-tickets`, `/start-issue` (via `issue:start`), `/implement-code`, `/judge-findings`, every agent Step, `/project-tickets`, `/implement-piece`, `/review-piece`, `/research-piece`, `/review-research`, `/close-project` (via `issue:close-parent`'s brief), `/project-spec`'s Phase gate, `/revise-workflows` (its pair and log modes) |
| Issue and session workspaces (`npm run issue:start`, [`git-workflow.md`](./git-workflow.md#a-skills-session-workspace)) | `/start-issue`, `/judge-findings`, `/implement-piece`'s issue workspace, `/research-piece`'s session workspace, the Edit gate's issue workspace in `/close-project`'s `piece.md` |
| Wrap-up (`npm run wrap-up`) | `/implement-code`, `/judge-findings`, the wrap-up Step, `/implement-piece`, `/research-piece`, `/close-project`'s `piece.md` |
| `npm run doc:print` | `/close-project`'s `piece.md` reads the Deliverable for the changed Sections; `/revise-workflows`' pair mode reads it for its diff; `/review-project-tickets`' reviewer reads its headings for a piece ticket's Sections |
| `npm run piece:pull` | `/start-issue` runs it on a piece drafting ticket; `/implement-piece` opens from its committed Agent draft and printed headings, and runs it itself when a session reached it without `/start-issue` |
| `runner -- decide` | `/runner`, `/implement-code`, `/implement-piece`, `/judge-findings` |
| `runner -- status` | `/runner` reads a run and, to diagnose, the Run board; `/review-project-tickets` and `/project-tickets`' Re-ticket read what has landed or started |
| `npm run overlap` | `/review-piece` runs it; `/implement-piece` reruns it after a fix; the piece resolve Step reruns it after its Fixes; `/judge-findings` reruns it after a piece "now" fix |
| `npm run size` | `/project-tickets` counts each code or piece work package's read set on disk with it, by [`tickets.md`](./tickets.md#ticket-size) |
| `npm run image:render` | `/implement-piece` and the piece implement Step render each agent image's SVG source to its PNG |
| `npm run pdf:text` and the page-range command in [`pdf-pages.md`](../pdf-pages.md) | `/research-piece` dumps text; `/plan-project` and `/review-research` count and print pages |
| `npm run issue:ready` | `/project-spec`'s Phase gate and `/project-tickets`' step 7 relabel a spec `ready-for-agent` through it; `file-issue` names it for a relabel by hand |
| `npm run doc:sections` | `file-issue`, `code-style`, `prose-style` and `writing` inject their rule sections through it |
| Sub-issues and native blocking edges | `/project-tickets`, `/judge-findings` and `/runner` set them through `npm run issue:file`; `/review-piece` reads the parent through `gh api`; `/project-spec` sets a held spec's blocked-by edge and its Phase gate walks the chain; `/judge-findings` and `/close-project` list what a closed spec blocks |
| The gworkspace tools (Drive and Docs) | `/plan-project`, `/implement-piece`, `/research-piece`, `/runner` on an `another source` answer |
| `npm run verify:quotes` | `/research-piece` and the research Step check the fact list; `/runner` checks an addendum |
| The Outline edits' code (`runner/src/outlineEdits.ts`) | a run applies an answered Research Halt's; `/research-piece` applies the developer's through `npm run outline:apply` |

## Out of scope

[`/grill-me`](../../.claude/skills/grill-me/SKILL.md), [`/inbox`](../../.claude/skills/inbox/SKILL.md), [`/wizard`](../../.claude/skills/wizard/SKILL.md), [`/prompt-scan`](../../.claude/skills/prompt-scan/SKILL.md), [`/pr`](../../.claude/skills/pr/SKILL.md), [`/retarget-after-gen-configs`](../../.claude/skills/retarget-after-gen-configs/SKILL.md) and [`/check-upstream-skills`](../../.claude/skills/check-upstream-skills/SKILL.md).
