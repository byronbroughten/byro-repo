# Delegating

A dispatched agent starts **cold**: it re-pays the root instructions plus every doc it opens. Delegate when an agent will read a lot and return a little, as in a sweep across many files, a review, or research. Do single-file edits, and anything already in context, inline.

- **Sweeps go to `repo-explorer`.** Use it when finding the answer means opening about 5 or more files. Do a single lookup inline. What it returns, and how much, is in [its definition](../../.claude/agents/repo-explorer.md#what-to-return).
- **The gates stay in the main session.** A dispatched agent has no one to ask, so it reports the command it would run and the plan behind it. The main session gets the yes and runs the command. The same goes for commits and `gh` writes.
- **Name the doc in the prompt.** Quote the Read-by-task row from `AGENTS.md` plus the exact file and block. A cold agent handed only a topic re-reads the map. Tell it to grep `columnConfigs.ts` by Table key (`repo-explorer` already knows to).
- **Require citations.** The report must give `file:line` and verbatim quotes; `repo-explorer` already does. A paraphrase has to be re-read before you can trust it, which costs more than the delegation saved.
- **Parallel agents read; one agent edits.** They share one working tree. Run `tsc` and the tests once, in the main session, after the edits land.
- **During design or grilling, dispatch only reads.** Findings come back in the report. Filing waits for the skill the user invokes, `/research` included.

Why it is shaped this way: [ADR 0016](../adr/0016-dispatched-agents-locate-and-quote-while-diagnosis-and-gates-stay-in-the-main-session.md).
