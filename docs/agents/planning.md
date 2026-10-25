# Design, specs, tickets and handoffs

- **During design or grilling, write only `GLOSSARY.md` entries**, as each term is resolved, and an ADR the developer said yes to; everything else waits until the user invokes the skill that files it. Approving a design does not approve publishing it. Reads are fine, and a subagent can do them ([`delegation.md`](./delegation.md)).
- **A plan or spec includes the matching prose-file edit** in its own scope ([`prose-files.md`](./prose-files.md)).

## Piece specs

- **A piece spec is grilled with `/grill-piece`**, which runs [`packages/writing/docs/grilling.md`](../../packages/writing/docs/grilling.md).
- **A piece spec is filed with `/piece-spec` and split with `/piece-tickets`**, never `/code-spec` or `/code-tickets`.

## Code in specs

- **Inline a shape (a record, type, schema or state machine) only when prose can't state the decision as precisely.**
- **A shape binds what it decides: which facts a record carries, which states and transitions exist, what a type allows.** Its form doesn't bind: names, how it's split, or whether it's a new type at all ([the implementer's precedence](../../.claude/skills/implement-code/SKILL.md#what-the-ticket-binds)).
- **Wording is verbatim only when the developer has said it is exact.** A planner never treats the developer's casual phrasing as verbatim.
- **A ticket that changes a tier rule quotes the row of the tier table it changes and says whether the change is stricter or looser.**

## Test seams

- **A spec's test seams name the outcome each test asserts**: for a Sheets write, the grid it leaves, not the requests it sends ([framework style](../../packages/framework/docs/code-style.md#tests)).

## Developer boxes

- **A `.claude/settings.json` change is a developer box.** Auto mode blocks an agent's edit to it as self-modification, so the spec quotes the exact lines and the implementer lists them in its hand-back for the developer to add.

## Phases

- **Split a spec into Phases only at a boundary where real use could change or cancel what follows.** Ticket count is never the reason, a feature whose value is already certain gets tickets rather than a gate, and a spec with no such boundary stays unphased.
- **A Phase is not a tracer bullet**: a tracer bullet is one verifiable slice, and a Phase is usually several that together can be used in real work.
- **Phase 1 is the smallest usable Phase**, and the spec names the stand-ins it runs on until a later Phase replaces them.
- **A phased spec has a `## Phases` section**: one line per Phase with its user story numbers and a status, `planned`, `ticketed`, `done` or `dropped`, a dropped one linking the gate that dropped it. Every Phase after the next is an outline marked provisional.
- **Only the next Phase is ticketed.** `/code-tickets` publishes its tickets and its Phase gate in one pass, the gate blocked by every ticket in the Phase, adding them as sub-issues after the earlier Phases' so the runner's order follows the Phases. The last Phase has no gate; closing the spec plays that role.
- **A Phase gate is a `ready-for-human` ticket** listing its Phase's tickets, a test checklist, note boxes for the data to record, and a `## Decision` section with three boxes: go, reshape, drop the rest. The developer's findings and any reshape details go in comments on the gate.
- **Only `/code-tickets` closes a Phase gate.** The developer ticks one decision box, runs `/code-tickets` on the gate, then reruns the runner.

## Ticket size

- **Size each ticket so one session finishes it without `/context` going much over the ticket budget (default ~150K); prefer 110–125K when a green seam makes that easy.** About 25K is fixed overhead before the first prompt.
- **Estimate from** the files it changes first: grep the names each draft ticket renames or retypes and count the files. Then add the files it reads, the docs the read-by-task table requires, its `tsc` and test loops, and whether it touches both packages.
- **A ticket that reads a body of text in full is sized by that text, not its file count**: an audit reads all the code it judges, a piece ticket its Supporting Material and Reference passages plus the spec's Outline and only the earlier Sections it opens for a fact or term. Measured over recent sessions, reading costs about 1K tokens per 2K characters of code (about 20 a line; #154 spent ~65K on 3.3K lines) and per 2.5K of Docs prose. Past ~60K of reading, name a subagent per part that returns only findings, or split the ticket; a drafter needs those passages in its own context, so a piece ticket splits.
- **Split a ticket that changes more than ~10 files**, and any other over-budget ticket, at a seam where each piece leaves `tsc` and tests green; each split pays the fixed overhead again. A bigger pair never fixes size ([`model-fit.md`](./model-fit.md#ticket-size)).
- **A rename or retype across more than ~10 files is a wide refactor**: sequence it expand–migrate–contract as `/code-tickets` describes, with a pure rename as its own mechanical ticket.
- **Make each ticket self-contained**: quote the spec rules it depends on, name the symbols it touches, and tell the implementer to open the parent spec only when a criterion is ambiguous. No file paths, per the skill.
- **An over-budget ticket with no green seam becomes two tickets**: an explore ticket (research or diagnosis) whose deliverable is a written finding posted on the implement ticket, and the implement ticket, blocked by it.

## Model fit

- **The pair lives in the ticket: a `## Model fit` section, last in the body, holding a pair line, then a one-line reason**, with `~NK` in the reason only for a ticket near its budget.
- **`/code-tickets` writes the section on every `ready-for-agent` ticket and none on a `ready-for-human` one**, then prints the tickets as one flat list in completion order, `#n Title: <Model> <effort> (reason)`, as a read-back.
- **`/code-spec` writes the section on a spec meant for one session.** A spec that won't fit one session is still published, without the section, and a chat line recommends `/code-tickets` for sub-issues; say nothing if the developer has explicitly agreed in the conversation that it becomes tickets.
- **`/piece-tickets` and `/piece-spec` stay chat only**: the same read-back list or one chat line, never in a ticket, comment or parent issue, with `/piece-tickets` as the recommendation for a spec too big for one session.
- **The developer switches with `/model` and `/effort`**; never dispatch an implementer.
- **Pick from five pairs only:** Sonnet medium, Sonnet high, Opus low, Opus medium, Opus high. Criteria for each and their evidence: [`model-fit.md`](./model-fit.md).
- **Tie-break: the cheapest pair likely to pass review on the first try.** Cost is the Claude Code weekly limit.

## Handoffs

Write a handoff when a diagnosis finishes in a session near the ticket budget, or one that got a read-count nudge, and do it before implementing. It holds the conclusion, the files and line ranges the next step opens (only those, not every range the ticket touches), and the hypotheses already ruled out. A session that got a context nudge writes one once the step in hand is done, adding the changed files and what still fails if the code is red, and leaves the work uncommitted. When less than half the ticket is done, it also proposes a split of the rest: the remaining slices as `/code-tickets` drafts them, each with what it delivers and its file count, for the developer to split the ticket before the next session. It ends with the `session: <id>` line from your context, which wrap-up reads. Post it as a comment on the issue, or save it as a file if there is no issue, then recommend a fresh session. A small diagnosis in a lean session needs no handoff.
