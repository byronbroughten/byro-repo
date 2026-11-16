# Tickets

The rules for sizing a ticket and picking its Model fit pair. What a spec holds is [`specs.md`](./specs.md)'s.

## Ticket size

- **Size each ticket so one session finishes it without `/context` going much over the ticket budget (default ~150K); prefer 110–125K when a green seam makes that easy.** About 25K is fixed overhead before the first prompt.
- **Merge tickets so fewer are estimated under 90K, and never make one estimated over 150K**; a target `/code-tickets` can override with a stated reason. Each ticket pays a cold start of context across implement and two reviewers, ~95K as measured while the review orchestrator still started cold, so a small ticket costs more per file, and cost per file flattens from ~110K ([estimates](./codebase-priorities/estimates.md#cost-per-ticket), [the review step's split](./codebase-priorities/estimates.md#steps)).
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
