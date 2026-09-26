# Model fit

The criteria behind the model and effort pair recommended after `/to-tickets` or `/to-spec`. The rule lines live in [`planning.md`](./planning.md#model-fit); open this guide when they don't decide a ticket, or when a new model version ships.

## Based on

Checked against Opus 5.5, Sonnet 5 and Grok 4.7. Reviewed 2026-09-25.

## Criteria for each pair

- **Opus low:** fully specified, an existing pattern, one package. Examples: a chore, an endpoint on existing machinery, a migrate batch needing some judgment, a retarget needing new names.
- **Opus medium:** any prose (a doc, an AGENTS.md edit, a comment), test restructuring, or choosing names or shapes inside a design the spec settles. Also the step up when an Opus low ticket has one soft spot.
- **Opus high:** type-level framework work, both packages or the framework's public entry, a new deletion path, an open design fork, or a wide refactor's contract or integrate-and-verify ticket.
- **Grok medium:** a batch of identical edits, or a rename or move following an exact stated pattern.
- **Grok high:** a pattern followed across several files, or names the ticket states word for word.

## Grok's rule

- Only when `tsc`, tests or lint check the whole diff. The reason names what checks it.
- It adds names only when the ticket states them word for word, so `tsc` catches a mismatch.
- Never a ticket that writes prose, a comment, a doc or AGENTS.md edit, a new class shape, or a test restructure.
- A ticket mixing eligible and ineligible work goes to Claude.
- Every Grok recommendation reminds the developer to have Grok read both style docs first, since Cursor lacked a STYLE gate until #167.

## Sonnet

Sonnet medium and Sonnet high: **not currently recommended** (checked 2026-09-25). Opus 5.5 low costs less per task and scores higher than Sonnet 5 at every effort level, and Sonnet 5's system card lists scope creep and rationalizing around explicit constraints. A later Sonnet release that reverses either can win its place back.

## Evidence

- **Cost per task.** Opus 5.5 low was cheapest and scored above Sonnet 5 at every effort level, on [CursorBench 4.0](https://cursor.com/cursorbench) (the only source comparing all seven pairs on one harness) and on the Artificial Analysis index ([Opus low](https://artificialanalysis.ai/models/claude-opus-5-5-low), [Sonnet high](https://artificialanalysis.ai/models/claude-sonnet-5-high), and their sibling pages). Cost per task is the best stand-in for weekly-limit use.
- **Weekly limits are one cap shared across models**, with no published weighting by model or effort ([Max plan](https://support.claude.com/en/articles/11049741-what-is-the-max-plan), [best practices](https://support.claude.com/en/articles/9797557-usage-limit-best-practices), [how limits work](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work)). Grok in Cursor never hits a limit, so it is free at the margin.
- **Higher Claude effort writes more comprehensive comments**, against this repo's short-comment rule. Opus 5.5 medium matches the previous Opus at high on coding; low comes close for much less ([effort](https://platform.claude.com/docs/en/build-with-claude/effort), [prompting Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5), [model config](https://code.claude.com/docs/en/model-config)).
- **FrontierCode**, the closest benchmark to style-guide adherence, grades against a repo's guidelines and penalizes out-of-scope changes. Opus 5.5 leads it and scores best at medium ([system card §8.4](https://www.anthropic.com/claude-opus-5-5-system-card)).
- **Sonnet 5's weaknesses** include scope creep and rationalizing around an explicit constraint ([system card](https://www.anthropic.com/claude-sonnet-5-system-card)).
- **Grok 4.7** has low, medium, high and xhigh effort ([reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning)); high scored only slightly above medium on CursorBench. xAI publishes no SWE-bench score ([announcement](https://x.ai/news/grok-4-7)). Grok 4.6 broke style rules here, though before the rules were fleshed out.

## What no benchmark covers

No public benchmark measures style-guide adherence for these models, and none of the three has an [IFEval or IFBench](https://artificialanalysis.ai/evaluations/ifbench) score. Grok's adherence evidence is only unofficial forum posts. The outcome log below is the evidence that decides Grok's boundary.

## When a new model version ships

1. Update the pinned versions under [Based on](#based-on).
2. Re-run the research brief.
3. Re-check each boundary and Sonnet's status against the new evidence and the outcome log.
4. Bump the reviewed date.

Research brief: "For each current model: API price, context window and release date. What each effort level changes, and the vendor's guidance on it. Coding benchmarks at each effort level, with cost or tokens per task, preferring one harness that covers every pair. Any evidence on following a written style guide or repo conventions. Primary sources first; mark non-primary; no invented numbers; list unknowns."

## Outcome log

One row per landed issue, added by the landing wrap-up; keep the most recent ~20. Pass means merged without a style or scope fix.

| Issue | Pair | Result | What review caught |
| --- | --- | --- | --- |
| #17 | Opus high | Fix | Small fixes after the first session; ticket too large for one model |
| #10 | Opus medium | Fix | Ticket too large for one model |
| #9 | Opus medium | Pass | — |
| #8 | Opus medium | Fix | Further implementation after the first session; ticket too large for one session (suggested pair was Opus high) |
| #3 | Opus high | Pass | — |
| #6 | Opus high | Pass | — |
| #168 | Opus low | Pass | — |
| #169 | Opus medium | Pass | — |
