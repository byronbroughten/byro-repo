# Design, specs, tickets and handoffs

- **During design or grilling, write nothing** until the user invokes the skill that files it. Approving a design does not approve publishing it. Reads are fine, and a subagent can do them ([`delegation.md`](./delegation.md)).
- **A plan or spec includes the matching prose-file edit** in its own scope ([`prose-files.md`](./prose-files.md)).
- **When a skill offers an ADR, propose a packages/framework/docs/design.md entry** instead: a new instance (a sentence in that principle's `docs/design/` file), a parked candidate (a line plus a heading in `docs/design/candidates.md`), or, with two citations, a new principle (a line plus a reasoning file). This repo keeps no `docs/adr/` tree ([`domain.md`](./domain.md)).

## Test seams

- **A spec's test seams name the outcome each test asserts**: for a Sheets write, the grid it leaves, not the requests it sends ([framework style](../../packages/framework/docs/style.md#tests)).

## Ticket size

- **Size each ticket so one session finishes it without `/context` going much over ~100K.** About 40K is fixed overhead before the first prompt, so the ticket gets about 60K, its required doc reads included.
- **Estimate from** the files and lines it reads, the docs the read-by-task table requires, the `tsc` and test loops it expects, and whether it touches both packages.
- **Split an over-budget ticket at a seam where each piece leaves `tsc` and tests green**; each split pays the fixed overhead again. A bigger pair never fixes size ([`model-fit.md`](./model-fit.md#ticket-size)).

## Model fit

- **After `/to-tickets` publishes**, print the tickets as one flat list in completion order, `#n Title: <Model> <effort> (reason)`, with `~NK` in the reason only for a ticket near its budget. Chat only: never in a ticket, comment or parent issue.
- **After `/to-spec` publishes**, say in one chat line which pair fits the spec, in the same form, and why. A spec that won't fit one session is still published, and the line recommends `/to-tickets` for sub-issues instead of a pair. Say nothing if the developer has explicitly agreed in the conversation that it becomes tickets. The developer switches with `/model` and `/effort`; never dispatch an implementer.
- **Pick from six pairs only:** Sonnet medium, Sonnet high, Opus low, Opus medium, Opus high, Grok 4.7 low. Never another Grok version or effort. Criteria for each and their evidence: [`model-fit.md`](./model-fit.md).
- **Tie-break: the cheapest pair likely to pass review on the first try.** Cost is the Claude Code weekly limit; Grok draws on Cursor's monthly pool, which runs short, so Grok is a fallback, not a default.
- **A Claude pick adds `· near limit: Grok 4.7 low`** when the ticket also passes Grok's rule, and nothing when it doesn't.
- **Grok only when `tsc`, tests or lint check the whole diff**, adding names only as stated word for word, and no prose, comment, doc, class shape or test restructure. A mixed ticket goes to Claude. The reason names what checks the diff and reminds the developer to have Grok read both style docs first.

## Handoffs

Write a handoff when a diagnosis finishes in a session near the ticket budget, or one that got a read-count nudge, and do it before implementing. It holds the conclusion, the files and line ranges to open, and the hypotheses already ruled out. Post it as a comment on the issue, or save it as a file if there is no issue, then recommend a fresh session. A small diagnosis in a lean session needs no handoff.
