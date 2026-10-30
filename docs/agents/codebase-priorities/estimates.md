# Estimates

An index of measured costs a tradeoff's estimate can come from, grouped by subject. Each line gives the number, its date, its source and the priorities it bears on.

## Reads

- Code costs ~1K tokens per 2K characters (median 2.0 characters a token, p10–p90 1.9–2.1, ~16 tokens a line; 146 reads), Docs prose ~1K per 2.5K (median 2.6, p10–p90 2.4–2.7; 266 reads); Opus 5.5 reads of 4K+ characters in session transcripts from 2026-10-01 to 10-30, measured by byro-repo#409; [`planning.md#ticket-size`](../planning.md#ticket-size), **A ticket that reads a body of text in full**. Agent cost.
- ~25K tokens of fixed overhead before a session's first prompt: an interactive session's first request is a median 26.0K (p10–p90 24.1–27.1K, 107 sessions, its short first prompt included), a runner step's 21.9K (20.5–25.1K, 142 steps); Opus 5.5 transcripts from 2026-10-24 to 10-30, measured by byro-repo#409. Before 2026-10-23 an interactive session's was ~43K. [`planning.md#ticket-size`](../planning.md#ticket-size), **Size each ticket so one session finishes it**. Agent cost.

## Tickets

- Per-ticket peak context, cost and duration, one file per landed issue, dated by its session ids: [`docs/agents/outcomes/`](../outcomes/), with older rows in [`legacy.md`](../outcomes/legacy.md); Research and older Pieces in the `personal` repo's `writing/docs/model-fit.md`. Agent cost, developer attention.

## Checks

- `npm run check`'s parts, from its own `Took:` line: tests median 42.9s (p90 48.9s), lint 21.1s (26.3s), `tsc` 13.6s (16.9s); 192 runs, 2026-10-22 to 10-30, measured by byro-repo#409 from session transcripts. Code run-time, agent cost.
- `npm run check` wall clock, the parts run at once: median 44.5s, p90 68.9s, 210 runs; skipped on a check stamp, median 0.7s, 9 runs; 2026-10-22 to 10-30, byro-repo#409. Agent cost.
- Run alone: `npm run tsc` median 5.3s (p90 9.0s, 16 runs), `npm run lint` 5.9s (range 1.0–6.4s, 6 runs); 2026-10-23 to 10-30, byro-repo#409. Agent cost.

## Commands

Wall clock from a Bash call to its result in this machine's session transcripts, hooks included, so it is what a session waits; measured by byro-repo#409, leaving out backgrounded calls, calls the developer approved at a prompt, and calls sent alongside another tool call.

- `gh issue view` median 1.1s (p90 2.0s, 86 calls); `npm run issue:read` 1.3s (1.7s, 112); 2026-09-30 to 10-30. Agent cost.
- `gh issue create` median 2.1s (p90 3.2s, 25 calls); `gh issue comment` 1.5s (2.0s, 24); `gh api` 1.6s (5.2s, 20); 2026-10-01 to 10-30. `gh issue edit` (3 calls, 1.6–2.8s) and `gh issue list` (1 call) are too few to rely on. Agent cost.
- One git command: `status`, `diff`, `log`, `show`, `add`, `branch`, `rev-parse` and `commit` each a median 0.4–0.6s, p90 at most 1.2s (7 to 68 calls each); `git worktree` 1.0s (range 0.9–1.2s, 7 calls); 2026-10-06 to 10-30. Agent cost.
- `npm run issue:start` median 4.7s (p90 8.2s, 46 calls); 2026-10-22 to 10-30. Agent cost.
- `npm run wrap-up` median 10.6s, p90 61.4s, range 0.5–113s, 34 calls, a landing running the checks and a run stopping early both counted; 2026-10-22 to 10-30. Agent cost.

## Type-check

- Baseline ~286k instantiations and ~1.2s check time, ~48k per mapped-filter instantiation; Sept 2026; [`type-check-cost.md`](../../../packages/framework/docs/architecture/type-check-cost.md#baseline-and-the-lazy-mapped-filter). Code run-time.
- What each typed change measured when it landed; [`type-check-cost.md`](../../../packages/framework/docs/architecture/type-check-cost.md#measurements-after-each-change). Code run-time.

## Sheets calls

- A round trip costs ~250–450ms against ~20–60ms of the framework's own CPU per trigger; Sept 2026; [`round-trips.md`](../../../packages/framework/docs/architecture/round-trips.md#the-chokepoints). Code run-time.
- Growing a Table by 1,500–5,000 rows in one batch costs 8–18% more than `appendCells`, before the format copy; undated, sheets-framework#53–#61; [`falsifiable-claims.md`](../../../packages/framework/docs/design/falsifiable-claims.md). Code run-time.
