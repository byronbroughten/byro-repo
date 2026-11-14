# Design, specs, tickets and handoffs

- **During design or grilling, write only `GLOSSARY.md` entries**, as each term is resolved, and an ADR the developer said yes to; everything else waits until the user invokes the skill that files it. Approving a design does not approve publishing it. Reads are fine, and a subagent can do them ([`delegation.md`](./delegation.md)).
- **A plan or spec includes the matching prose-file edit** in its own scope ([`prose-files.md`](./prose-files.md)).

## Piece specs

- **A piece spec is grilled with `/grill-piece`**, which runs [`docs/pieces/grilling.md`](../pieces/grilling.md).
- **A piece spec is filed with `/project-spec` and split with `/piece-tickets`**, never `/code-tickets`.
- **Every piece spec gets tickets: at least one drafting ticket, and its Edit gate last**, a `ready-for-human` ticket blocked by every drafting ticket ([`/piece-tickets`](../../.claude/skills/piece-tickets/SKILL.md)).

## Code in specs

- **Inline a shape (a record, type, schema or state machine) only when prose can't state the decision as precisely.**
- **A shape binds what it decides: which facts a record carries, which states and transitions exist, what a type allows.** Its form doesn't bind: names, how it's split, or whether it's a new type at all ([the implementer's precedence](../../runner/skills/implement-code/SKILL.md#what-the-ticket-binds)).
- **Wording is verbatim only when the developer has said it is exact.** A planner never treats the developer's casual phrasing as verbatim.
- **A ticket that changes a tier rule quotes the row of the tier table it changes and says whether the change is stricter or looser.**

## Test seams

- **A spec's test seams name the outcome each test asserts**: for a Sheets write, the grid it leaves, not the requests it sends ([framework style](../../packages/framework/docs/code-style.md#tests)).

## Settings changes

- **A `.claude/settings.json` change is agent work**: a step's edit can add a hook or permission rule for later steps on its own ticket, but can't remove a primary gate ([guardrails](../claude-code-guardrails.md#the-hooks-and-the-project-agent)).

## Phases

Each Phase is a spec of its own, filed with the rest of its Project by [`/project-spec`](../../.claude/skills/project-spec/SKILL.md), which also runs each Phase gate.

- **Split work into several specs for a gate (real use could change or cancel what follows) or for size (a spec headed past about 55 user stories or about 25K characters of body).** The size line is fuzzy, weighed with the other considerations, and `/mine-outcomes` may retune it.
- **Each spec stands on its own: it lands green and leaves master consistent, with nothing half-migrated.** Operator-visible value is preferred; an enabling spec is allowed when no such slice fits, and its Problem Statement says so.
- **A spec that replaces something also removes the old version, docs included.** That removal and any docs sweep are tickets in that spec, never specs of their own.
- **A Phase is not a tracer bullet**: a tracer bullet is one verifiable slice, and a Phase is a spec, usually several slices that together can be used in real work.
- **The first Phase is the smallest usable spec**, and it names the stand-ins it runs on until a later Phase replaces them.

## Ticket size

- **Size each ticket so one session finishes it without `/context` going much over the ticket budget (default ~150K); prefer 110–125K when a green seam makes that easy.** About 25K is fixed overhead before the first prompt.
- **Merge tickets so fewer are estimated under 90K, and never make one estimated over 150K**; a target `/code-tickets` can override with a stated reason. Each ticket pays a cold start of ~95K of context across implement, the review orchestrator and two reviewers, so a small ticket costs more per file, and cost per file flattens from ~110K ([estimates](./codebase-priorities/estimates.md#cost-per-ticket), [the review step's split](./codebase-priorities/estimates.md#steps)).
- **Merge only tickets with the same Model fit pair, neither blocking the other**: a merged ticket never needs a stronger pair, so a Sonnet 60K ticket and an Opus 60K one stay two tickets.
- **Estimate a ticket as fixed overhead + reads + a work allowance of ~55K for a runner step or ~85K for an interactive session**, covering thinking, Edit and Write bodies, check loops and other tool output ([`estimates.md`](./codebase-priorities/estimates.md#work)).
- **Reads are the files it changes, counted by grepping the names each draft ticket renames or retypes, plus the files it reads beside them, the docs the read-by-task table requires, the issues it links and ~5K of re-reads of the files it edits.**
- **A file the ticket edits counts at its full size when it is under ~300 lines or the change adds code that depends on the rest of it**, in every ticket that edits it.
- **A ticket that reads a body of text in full is sized by that text, not its file count**: an audit reads all the code it judges, a piece ticket its Supporting Material and Reference passages plus the spec's Outline and only the earlier Sections it opens for a fact or term. Reading costs about 1K tokens per 2K characters of code (about 16 a line) and per 2.5K of Docs prose. Past ~60K of reading, name a subagent per part that returns only findings, or split the ticket; a drafter needs those passages in its own context, so a piece ticket splits.
- **Split an over-budget ticket by its estimate, never by its file count alone**, at a seam where each piece leaves `tsc` and tests green; each split pays the fixed overhead again. A bigger pair never fixes size ([`model-fit.md`](./model-fit.md#ticket-size)).
- **A rename or retype across more than ~10 files is a wide refactor**: sequence it expand–migrate–contract as `/code-tickets` describes, with a pure rename as its own mechanical ticket.
- **Make each ticket self-contained**: quote the spec rules it depends on, name the symbols it touches, and tell the implementer to open the parent spec only when a criterion is ambiguous. No file paths, per the skill.
- **Leave the implementer every choice the code, the design docs and the code style settle; a ticket must settle only what would otherwise be a contradiction, an undefined term or a case its own rule leaves open**, since the implement step carries on with the reading the ticket best supports and halts only on those.
- **An over-budget ticket with no green seam becomes two tickets**: an explore ticket (research or diagnosis) whose deliverable is a written finding posted on the implement ticket, and the implement ticket, blocked by it.

## Model fit

- **The pair lives in the ticket: a `## Model fit` section, last in the body, holding a pair line, then a one-line reason**, with `~NK` in the reason only for a ticket near its budget.
- **`/code-tickets`, `/project-spec` and `/piece-tickets` write the section**, each by its own rule: [which tickets, and the read-back](../../.claude/skills/code-tickets/SKILL.md#7-read-back-the-model-fit), [which code specs](../../.claude/skills/project-spec/SKILL.md#5-write-each-spec), in the paragraph after its code template, and [every `ready-for-agent` piece ticket](../../.claude/skills/piece-tickets/SKILL.md#3-file-the-tickets).
- **`/project-spec` writes none in a piece spec**: a piece spec's pairs are its tickets'.
- **The developer switches with `/model` and `/effort`**; never dispatch an implementer.
- **A Model fit check compares the model only**: the agent can't see `/effort`, so it names an effort only when the developer has said what it is.
- **Pick from six pairs only:** Haiku medium, Sonnet medium, Sonnet high, Opus low, Opus medium, Opus high. Criteria for each and their evidence: [`model-fit.md`](./model-fit.md).
- **Tie-break: the cheapest pair likely to pass review on the first try.** Cost is the Claude Code weekly limit.

## Handoffs

Write a handoff when a diagnosis finishes in a session near the ticket budget, or one that got a read-count nudge, and do it before implementing. It holds the conclusion, the files and line ranges the next step opens (only those, not every range the ticket touches), and the hypotheses already ruled out. A session that got a context nudge writes one once the step in hand is done, adding the changed files and what still fails if the code is red, and leaves the work uncommitted. When less than half the ticket is done, it also proposes a split of the rest: the remaining slices as `/code-tickets` drafts them, each with what it delivers and its file count, for the developer to split the ticket before the next session. It ends with the `session: <id>` line from your context, which wrap-up reads. Post it as a comment on the issue, or save it as a file if there is no issue, then recommend a fresh session. A small diagnosis in a lean session needs no handoff.
