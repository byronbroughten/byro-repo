# Delegating

A dispatched agent starts **cold**: it re-pays the root instructions plus every doc it opens. Delegate when an agent will read a lot and return a little, as in a sweep across many files, a review, or research. Do single-file edits, and anything already in context, inline.

## Delegation rules

- **Sweeps go to `repo-explorer` when the files they open total more than [the session's threshold](#sweep-thresholds) by `npm run size`, or can't be named in advance.** Do a single lookup inline. What it returns, and how much, is in [its definition](../../.claude/agents/repo-explorer.md#what-to-return).
- **The gates stay in the main session.** A dispatched agent has no one to ask, so it reports the command it would run and the plan behind it. The main session gets the yes and runs the command. The same goes for commits and `gh` writes.
- **Name the doc in the prompt.** Quote the Read-by-task row from `AGENTS.md` plus the exact file and block. A cold agent handed only a topic re-reads the map. Tell it to grep `columnConfigs.ts` by Table key (`repo-explorer` already knows to).
- **Require citations.** The report must give `file:line` and verbatim quotes; `repo-explorer` already does. A paraphrase has to be re-read before you can trust it, which costs more than the delegation saved.
- **Parallel agents read; one agent edits.** They share one working tree. Run `tsc` and the tests once, in the main session, after the edits land.
- **During design or grilling, dispatch only reads.** Findings come back in the report. Filing waits for the skill the user invokes, `/research` included.

Why it is shaped this way: [ADR 0016](../adr/0016-dispatched-agents-locate-and-quote-while-diagnosis-and-gates-stay-in-the-main-session.md).

## Sweep thresholds

A session's kind is its runner step, or the skill that opened an interactive session. Each row is where a spawn costs less than carrying the read for the session's [measured remaining turns](./codebase-priorities/estimates.md#reads); the arithmetic is in [`delegation/thresholds.md`](./delegation/thresholds.md).

| Session | Delegate a sweep over |
| --- | --- |
| The implement and resolve steps, `/start-issue`, `/code-tickets` | 8K tokens |
| The review step | 25K tokens |
| The gap check | never: do it inline |
| Any other session | 5K tokens |
