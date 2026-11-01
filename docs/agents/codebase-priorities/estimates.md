# Estimates

An [observation index](../prose-files.md#terms) of measured costs a tradeoff's estimate can come from, grouped by subject, following the [observation-index rules](../../prose-style.md#observation-indexes). Each line gives its tag, the measurement, its conditions, its date, its evidence and the priorities it bears on.

Per-ticket peak context, cost and duration are a record, not an observation: one file per landed issue, dated by its session ids, in [`docs/agents/outcomes/`](../outcomes/), with older rows in [`legacy.md`](../outcomes/legacy.md); Research and older Pieces are in the `personal` repo's `writing/docs/model-fit.md`.

## Reads

- Observed: Code costs ~1K tokens per 2K characters (median 2.0 characters a token, p10–p90 1.9–2.1, ~16 tokens a line; 146 reads), Docs prose ~1K per 2.5K (median 2.6, p10–p90 2.4–2.7; 266 reads); Opus 5.5 reads of 4K+ characters in session transcripts from 2026-10-01 to 2026-10-30, measured by byro-repo#409; [recorded in b75a66e7](https://github.com/byronbroughten/byro-repo/commit/b75a66e7c84a852d977214074a5bbb7b152fb6e8). Relied on by [`planning.md#ticket-size`](../planning.md#ticket-size), **A ticket that reads a body of text in full**. Agent cost.
- Observed: ~25K tokens of fixed overhead before a session's first prompt: an interactive session's first request is a median 26.0K (p10–p90 24.1–27.1K, 107 sessions, its short first prompt included), a runner step's 21.9K (20.5–25.1K, 142 steps); Opus 5.5 transcripts from 2026-10-24 to 2026-10-30, measured by byro-repo#409; [recorded in b75a66e7](https://github.com/byronbroughten/byro-repo/commit/b75a66e7c84a852d977214074a5bbb7b152fb6e8). Relied on by [`planning.md#ticket-size`](../planning.md#ticket-size), **Size each ticket so one session finishes it**. Agent cost.
- Observed: before 2026-10-23 an interactive session's first request was higher: daily medians 42.4–43.3K over 146 sessions from 2026-10-18 to 2026-10-22, measured by byro-repo#409; [recorded in b75a66e7](https://github.com/byronbroughten/byro-repo/commit/b75a66e7c84a852d977214074a5bbb7b152fb6e8). Agent cost.

## Checks

- Observed: `npm run check`'s parts, from its own `Took:` line: tests median 42.9s (p90 48.9s), lint 21.1s (26.3s), `tsc` 13.6s (16.9s); 192 runs, 2026-10-22 to 2026-10-30, measured by byro-repo#409 from session transcripts; [recorded in b75a66e7](https://github.com/byronbroughten/byro-repo/commit/b75a66e7c84a852d977214074a5bbb7b152fb6e8). Code run-time, agent cost.
- Observed: `npm run check` wall clock, the parts run at once: median 44.5s, p90 68.9s, 210 runs; skipped on a check stamp, median 0.7s, 9 runs; 2026-10-22 to 2026-10-30, byro-repo#409; [recorded in b75a66e7](https://github.com/byronbroughten/byro-repo/commit/b75a66e7c84a852d977214074a5bbb7b152fb6e8). Agent cost.
- Observed: run alone, `npm run tsc` median 5.3s (p90 9.0s, 16 runs), `npm run lint` 5.9s (range 1.0–6.4s, 6 runs); 2026-10-23 to 2026-10-30, byro-repo#409; [recorded in b75a66e7](https://github.com/byronbroughten/byro-repo/commit/b75a66e7c84a852d977214074a5bbb7b152fb6e8). Agent cost.

## Commands

Wall clock from a Bash call to its result in this machine's session transcripts, hooks included, so it is what a session waits; measured by byro-repo#409, leaving out backgrounded calls, calls the developer approved at a prompt, and calls sent alongside another tool call.

- Observed: `gh issue view` median 1.1s (p90 2.0s, 86 calls); `npm run issue:read` 1.3s (1.7s, 112); 2026-09-30 to 2026-10-30, byro-repo#409; [recorded in b75a66e7](https://github.com/byronbroughten/byro-repo/commit/b75a66e7c84a852d977214074a5bbb7b152fb6e8). Agent cost.
- Observed: `gh issue create` median 2.1s (p90 3.2s, 25 calls); `gh issue comment` 1.5s (2.0s, 24); `gh api` 1.6s (5.2s, 20); `gh issue edit` 3 calls, 1.6–2.8s; `gh issue list` 1 call; 2026-10-01 to 2026-10-30, byro-repo#409; [recorded in b75a66e7](https://github.com/byronbroughten/byro-repo/commit/b75a66e7c84a852d977214074a5bbb7b152fb6e8). Agent cost.
- Observed: one git command, `status` median 0.5s (p90 0.7s, 34 calls), `diff` 0.4s (0.8s, 44), `log` 0.5s (1.1s, 31), `commit` 0.6s (range 0.5–1.5s, 7), `worktree` 1.0s (range 0.9–1.2s, 7); 2026-10-06 to 2026-10-30, byro-repo#409; [recorded in b75a66e7](https://github.com/byronbroughten/byro-repo/commit/b75a66e7c84a852d977214074a5bbb7b152fb6e8). Agent cost.
- Observed: `npm run issue:start` median 4.7s (p90 8.2s, 46 calls); 2026-10-22 to 2026-10-30, byro-repo#409; [recorded in b75a66e7](https://github.com/byronbroughten/byro-repo/commit/b75a66e7c84a852d977214074a5bbb7b152fb6e8). Agent cost.
- Observed: `npm run wrap-up` median 10.6s, p90 61.4s, range 0.5–113s, 34 calls, a landing running the checks and a run stopping early both counted; 2026-10-22 to 2026-10-30, byro-repo#409; [recorded in b75a66e7](https://github.com/byronbroughten/byro-repo/commit/b75a66e7c84a852d977214074a5bbb7b152fb6e8). Agent cost.

## Type-check

- Observed: baseline ~286k instantiations and ~1.2s check time, ~48k per mapped-filter instantiation; 2026-09-02, the date of [ecd32996](https://github.com/byronbroughten/byro-repo/commit/ecd32996faf29f3daa60dd820c8e817a37181e4f), which recorded it; [`type-check-cost.md`](../../../packages/framework/docs/architecture/type-check-cost.md#baseline-and-the-lazy-mapped-filter). Code run-time.
- Observed: what each typed change measured when it landed, the first recorded on 2026-09-07 in [1d53d838](https://github.com/byronbroughten/byro-repo/commit/1d53d8389d3c9d6dd99f480b2f15df74d6ae1cdc); [`type-check-cost.md`](../../../packages/framework/docs/architecture/type-check-cost.md#measurements-after-each-change). Code run-time.

## Sheets calls

- Observed: a round trip costs ~250–450ms against ~20–60ms of the framework's own CPU per trigger; 2026-09-01, the date of [933351eb](https://github.com/byronbroughten/byro-repo/commit/933351eb4f6cc87f6b8c82869b397f918e913cbd), which recorded it; [`round-trips.md`](../../../packages/framework/docs/architecture/round-trips.md#the-chokepoints). Code run-time.
- Observed: growing a Table by 1,500–5,000 rows in one batch costs 8–18% more than `appendCells`, before the format copy; 2026-10-01 to 2026-10-02, [sheets-framework#53](https://github.com/byronbroughten/sheets-framework/issues/53)–#61; [`falsifiable-claims.md`](../../../packages/framework/docs/design/falsifiable-claims.md). Code run-time.
