# Design, specs, tickets and handoffs

- **During design or grilling, write nothing** until the user invokes the skill that files it. Approving a design does not approve publishing it. Reads are fine, and a subagent can do them ([`delegation.md`](./delegation.md)).
- **A plan or spec includes the matching prose-file edit** in its own scope ([`prose-files.md`](./prose-files.md)).
- **When a skill offers an ADR, propose a packages/framework/docs/design.md entry** instead: a new instance (a sentence in that principle's `docs/design/` file), a parked candidate (a line plus a heading in `docs/design/candidates.md`), or, with two citations, a new principle (a line plus a reasoning file). This repo keeps no `docs/adr/` tree ([`domain.md`](./domain.md)).

## Piece specs

- **Grilling a piece spec starts from [`packages/writing/docs/grilling.md`](../../packages/writing/docs/grilling.md).**
- **A piece spec is filed with `/to-piece-spec` and split with `/to-piece-tickets`**, never `/to-spec` or `/to-tickets`.

## Test seams

- **A spec's test seams name the outcome each test asserts**: for a Sheets write, the grid it leaves, not the requests it sends ([framework style](../../packages/framework/docs/code-style.md#tests)).

## Developer boxes

- **A `.claude/settings.json` change is a developer box.** Auto mode blocks an agent's edit to it as self-modification, so the spec quotes the exact lines and the implementer lists them in its hand-back for the developer to add.

## Ticket size

- **Size each ticket so one session finishes it without `/context` going much over ~150K; prefer 110–125K when a green seam makes that easy.** About 40K is fixed overhead before the first prompt.
- **Estimate from** the files it changes first: grep the names each draft ticket renames or retypes and count the files. Then add the files it reads, the docs the read-by-task table requires, its `tsc` and test loops, and whether it touches both packages.
- **Split a ticket that changes more than ~10 files**, and any other over-budget ticket, at a seam where each piece leaves `tsc` and tests green; each split pays the fixed overhead again. A bigger pair never fixes size ([`model-fit.md`](./model-fit.md#ticket-size)).
- **A rename or retype across more than ~10 files is a wide refactor**: sequence it expand–migrate–contract as `/to-tickets` describes, with a pure rename as its own mechanical ticket.
- **Make each ticket self-contained**: quote the spec rules it depends on, name the symbols it touches, and tell the implementer to open the parent spec only when a criterion is ambiguous. No file paths, per the skill.
- **An over-budget ticket with no green seam splits into two sessions**: one explores and posts a handoff ([Handoffs](#handoffs)), and a fresh session implements from it.

## Model fit

- **After `/to-tickets` or `/to-piece-tickets` publishes**, print the tickets as one flat list in completion order, `#n Title: <Model> <effort> (reason)`, with `~NK` in the reason only for a ticket near its budget. Chat only: never in a ticket, comment or parent issue.
- **After `/to-spec` or `/to-piece-spec` publishes**, say in one chat line which pair fits the spec, in the same form, and why. A spec that won't fit one session is still published, and the line recommends `/to-tickets` or `/to-piece-tickets` for sub-issues instead of a pair. Say nothing if the developer has explicitly agreed in the conversation that it becomes tickets. The developer switches with `/model` and `/effort`; never dispatch an implementer.
- **Pick from six pairs only:** Sonnet medium, Sonnet high, Opus low, Opus medium, Opus high, Grok 4.7 low. Never another Grok version or effort. Criteria for each and their evidence: [`model-fit.md`](./model-fit.md).
- **Tie-break: the cheapest pair likely to pass review on the first try.** Cost is the Claude Code weekly limit; Grok draws on Cursor's monthly pool, which runs short, so Grok is a fallback, not a default.
- **A Claude pick adds `· near limit: Grok 4.7 low`** when the ticket also passes Grok's rule, and nothing when it doesn't.
- **Grok only when `tsc`, tests or lint check the whole diff**, adding names only as stated word for word, and no prose, comment, doc, class shape or test restructure. A mixed ticket goes to Claude. The reason names what checks the diff and reminds the developer to have Grok read both style docs first.

## Handoffs

Write a handoff when a diagnosis finishes in a session near the ticket budget, or one that got a read-count nudge, or when an exploration session for an unsplittable ticket finishes, and do it before implementing. It holds the conclusion, the files and line ranges to open, and the hypotheses already ruled out. A session that got a context nudge writes one once the step in hand is done, adding the changed files and what still fails if the code is red, and leaves the work uncommitted. Post it as a comment on the issue, or save it as a file if there is no issue, then recommend a fresh session. A small diagnosis in a lean session needs no handoff.
