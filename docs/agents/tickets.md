# Tickets

The one home for ticketing judgments: the ticket split test, work packages, sizing and grouping a ticket, the repos it touches, its `## Where` and its Model fit pair. What a spec holds is [`specs.md`](./specs.md)'s.

## The ticket split test

- **Work is more than one ticket when any of these holds:**
  - its estimate is over the ~135K cap ([Ticket size](#ticket-size));
  - its parts need different kinds;
  - its parts need pairs whose merge would put the cheap part on the costly pair;
  - it is a wide refactor with no green state short of expand–migrate–contract;
  - it is a piece or mixed spec, which always gets tickets.
- **Work that passes is one ticket**: a spec with a `## Model fit` section, or a single filed ticket.
- **Every agent but a ticketing one only answers whether work passes, never how to split it**: reviewers, resolvers, an implementer writing a handoff, `/project-spec` and the Phase gate cite this test, and [`/project-tickets`](../../.claude/skills/project-tickets/SKILL.md) does the splitting.

## Work packages

- **A work package is the smallest change in a spec that leaves the checks green**, named by what changes, the symbols it touches and the files it reads, never how.
- **Two packages that always land together, with no green state between them worth having, are one.**
- **Count a package's read set with grep and line counts, not close reading.**
- **Packages are never published**: a ticketing skill groups them into tickets, and only the tickets are filed.

## Ticket size

- **Size each ticket so one session finishes it: never estimate one over the cap, the ticket budget minus the margin knob (`budgetMargin`, ~135K by default)**, with the ticket budget (~150K) kept as the preferred ceiling for a session's peak. About 25K is fixed overhead before the first prompt.
- **Prefer 110–125K when a green seam makes that easy.**
- **Merge tickets so fewer are estimated under 90K**; a target a ticketing skill can override with a stated reason. Each ticket pays a cold start of context across implement and two reviewers, ~95K as measured while the review orchestrator still started cold, so a small ticket costs more per file, and cost per file flattens from ~110K ([estimates](./codebase-priorities/estimates.md#cost-per-ticket), [the review step's split](./codebase-priorities/estimates.md#steps)).
- **Merge only packages with the same Model fit pair**: a merged ticket never needs a stronger pair, so a Sonnet 60K package and an Opus 60K one stay two tickets.
- **A package may merge with one it blocks when no package outside the group sits between them.**
- **Estimate a grouped ticket as fixed overhead + the union of its packages' read sets + one flat work allowance of ~55K for a runner step or ~85K for an interactive session**, covering thinking, Edit and Write bodies, check loops and other tool output; the allowance rests on byro-repo#498's estimates ([`estimates.md`](./codebase-priorities/estimates.md#work)).
- **`/mine-outcomes` revisits the flat allowance once a batch holds 30 outcome rows with an Estimate**, proposing a per-package allowance or confirming the flat one; `--all` takes every uncleared section.
- **A package's read set is the files it changes, counted by grepping the names it renames or retypes, plus the files it reads beside them, the docs the read-by-task table requires, the issues it links and ~5K of re-reads of the files it edits**; a file in two packages' sets counts once in their ticket.
- **A file the ticket edits counts at its full size when it is under ~300 lines or the change adds code that depends on the rest of it**, in every ticket that edits it.
- **A ticket that reads a body of text in full is sized by that text, not its file count**: an audit reads all the code it judges, a piece ticket its packages' read sets. Reading costs about 1K tokens per 2K characters of code (about 16 a line) and per 2.5K of Docs prose. Past ~60K of reading, name a subagent per part that returns only findings, or split the ticket; a drafter needs those passages in its own context, so a piece ticket splits, between Sections.
- **A piece work package's read set is its Supporting Material and Reference passages, counted in characters at the Docs rate, plus the spec's Outline and the earlier Sections it opens**; a single Section over ~60K of reading is flagged to the developer, never split mid-Section.
- **Split an over-cap ticket by its estimate, never by its file count alone**, at a seam where each piece leaves `tsc` and tests green; each split pays the fixed overhead again. A bigger pair never fixes size ([`model-fit.md`](./model-fit.md#ticket-size)).
- **Vertical slices stay the default, with any prefactoring first; a cut at a named seam is allowed where each side lands green with its own tests.**
- **A rename or retype across more than ~10 files is a wide refactor**: sequence it expand–migrate–contract as [`/project-tickets`](../../.claude/skills/project-tickets/SKILL.md#wide-refactors) describes, with a pure rename as its own mechanical ticket.
- **A spec drafted into more than about 20 tickets stops filing and proposes a Phase split**; the line is fuzzy, and `/mine-outcomes` may retune it.
- **Make each ticket self-contained**: quote the spec rules it depends on, name the symbols it touches in its `## Where`, and tell the implementer to open the parent spec only when a criterion is ambiguous. No file paths, per the skill; a naming pattern such as `<Subject>.<aspect>.test.ts` is allowed.
- **Leave the implementer every choice the code, the design docs and the code style settle; a ticket must settle only what would otherwise be a contradiction, an undefined term or a case its own rule leaves open**, since the implement step carries on with the reading the ticket best supports and halts only on those.
- **An over-cap ticket with no green seam becomes two tickets**: an explore ticket (research or diagnosis) whose deliverable is a written finding posted on the implement ticket, and the implement ticket, blocked by it.

## Repos

- **A ticket may touch any repo**; the implement step promotes each extra one onto the ticket's branch.
- **A ticket is always filed in its spec's repo.**
- **A ticket filed in a public repo never describes work in a private one**: check each repo's visibility with `npm run repos`.

## Where

- **Every `ready-for-agent` and `ready-for-interactive` ticket has a `## Where` section, before `## Targets` when it has one, otherwise before `## Model fit`.**
- **It names the symbols the ticket touches, a landed ticket or file to copy as a pattern, and naming patterns** such as `<Subject>.<aspect>.test.ts`.
- **A symbol that doesn't exist yet is named by the blocking ticket that adds it**, as in "the flush classifier #733 adds".

## Model fit

- **The pair lives in the ticket: a `## Model fit` section, last in the body, holding a pair line, then a one-line reason ending with the ticket's estimate as `~NK`.**
- **`/project-tickets` and `/project-spec` write the section**, each by its own rule: [every agent and interactive ticket](../../.claude/skills/project-tickets/SKILL.md#code-ticket-template), [every `ready-for-agent` piece ticket](../../.claude/skills/project-tickets/SKILL.md#piece-ticket-template), [and the read-back](../../.claude/skills/project-tickets/SKILL.md#8-read-back-the-pairs); [the code specs that pass the split test](../../.claude/skills/project-spec/SKILL.md#5-write-each-spec), in the paragraph after its code template.
- **`/project-spec` writes none in a piece or mixed spec**: its pairs are its tickets'.
- **The developer switches with `/model` and `/effort`**; never dispatch an implementer.
- **A Model fit check compares the model only**: the agent can't see `/effort`, so it names an effort only when the developer has said what it is.
- **Pick from six pairs only:** Haiku medium, Sonnet medium, Sonnet high, Opus low, Opus medium, Opus high. Criteria for each and their evidence: [`model-fit.md`](./model-fit.md).
- **Tie-break: the cheapest pair likely to pass review on the first try.** Cost is the Claude Code weekly limit.
