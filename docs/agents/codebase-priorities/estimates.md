# Estimates

An index of measured costs a tradeoff's estimate can come from, grouped by subject. Each line gives the number, its date, its source and the priorities it bears on.

## Reads

- Code costs ~1K tokens per 2K characters (~20 a line), Docs prose ~1K per 2.5K; undated, over sessions up to #154; [`planning.md:38`](../planning.md#ticket-size). Agent cost.
- ~25K tokens of fixed overhead before a session's first prompt; [`planning.md:36`](../planning.md#ticket-size). Agent cost.

## Tickets

- Per-ticket peak context, cost and duration, one file per landed issue, dated by its session ids: [`docs/agents/outcomes/`](../outcomes/), with older rows in [`legacy.md`](../outcomes/legacy.md); Research and older Pieces in the `personal` repo's `writing/docs/model-fit.md`. Agent cost, developer attention.

## Checks

- `npm run check`'s parts: `tsc` 14.4s, tests 45.7s, lint 23.4s; measured 2026-10-25, recorded here. Code run-time, agent cost.

## Type-check

- Baseline ~286k instantiations and ~1.2s check time, ~48k per mapped-filter instantiation; Sept 2026; [`type-check-cost.md`](../../../packages/framework/docs/architecture/type-check-cost.md#baseline-and-the-lazy-mapped-filter). Code run-time.
- What each typed change measured when it landed; [`type-check-cost.md`](../../../packages/framework/docs/architecture/type-check-cost.md#measurements-after-each-change). Code run-time.

## Sheets calls

- A round trip costs ~250–450ms against ~20–60ms of the framework's own CPU per trigger; Sept 2026; [`round-trips.md`](../../../packages/framework/docs/architecture/round-trips.md#the-chokepoints). Code run-time.
- Growing a Table by 1,500–5,000 rows in one batch costs 8–18% more than `appendCells`, before the format copy; undated, sheets-framework#53–#61; [`falsifiable-claims.md`](../../../packages/framework/docs/design/falsifiable-claims.md). Code run-time.
