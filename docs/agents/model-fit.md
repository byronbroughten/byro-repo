# Model fit

The criteria behind the model and effort pair recommended after `/to-tickets` or `/to-spec`. The rule lines live in [`planning.md`](./planning.md#model-fit); open this guide when they don't decide a ticket, or when a new model version ships.

## Based on

Checked against Opus 5.5, Sonnet 5.5 and Grok 4.7. Reviewed 2026-09-30.

## Criteria for each pair

- **Sonnet medium:** code only, and `tsc`, tests or lint check the whole diff: a pattern followed across several files, or names the ticket states word for word. Also a batch or rename too big for Grok's pool.
- **Sonnet high:** the Opus low shape (fully specified, an existing pattern, one package) when the ticket writes no prose or comment and chooses no names.
- **Opus low:** fully specified, an existing pattern, one package. Examples: a chore, an endpoint on existing machinery, a migrate batch needing some judgment, a retarget needing new names.
- **Opus medium:** any prose (a doc, an AGENTS.md edit, a comment), test restructuring, or choosing names or shapes inside a design the spec settles. Also the step up when an Opus low ticket has one soft spot.
- **Opus high:** type-level framework work, both packages or the framework's public entry, a new deletion path, an open design fork, or a wide refactor's contract or integrate-and-verify ticket.
- **Grok 4.7 low:** a small batch of identical edits, or a rename or move following an exact stated pattern. The only Grok pair: no other Grok version or effort.

## Ticket size

A bigger pair never fixes a ticket that won't fit one session: #8 and #17 were Opus high picks and still too large, and #21 needed fixes after nearly 200K. Split it instead ([`planning.md`](./planning.md#ticket-size)). The Peak context column below checks the ~100K budget.

## Grok's rule

- Only when `tsc`, tests or lint check the whole diff. The reason names what checks it.
- It adds names only when the ticket states them word for word, so `tsc` catches a mismatch.
- Never a ticket that writes prose, a comment, a doc or AGENTS.md edit, a new class shape, or a test restructure.
- A ticket mixing eligible and ineligible work goes to Claude.
- Grok draws on Cursor's monthly pool, which the developer has been exhausting, so it is never the default: a Claude pick names it only as the near-limit fallback, and a ticket goes to Grok first only when it is tiny.
- Every Grok recommendation reminds the developer to have Grok read both style docs first, since Cursor lacked a STYLE gate until #167.

## Sonnet

Sonnet 5.5 is back in the pairs (checked 2026-09-30), on probation for code-only tickets until the outcome log shows first-try passes. Sonnet 5.5 medium and high cost less per task than Opus 5.5 medium, and high scores above Opus low. It improves on Sonnet 5's constraint-following but still trails Opus 5.5 on circumventing constraints and on out-of-scope-graded FrontierCode, so prose, naming and design stay with Opus.

## Evidence

- **Cost per task** on [CursorBench 4.0](https://cursor.com/cursorbench) (Sep 10, 2026), the only source comparing every pair on one harness. Score and API cost per task: Sonnet 5.5 low 35.8% $0.50, medium 39.2% $0.70, high 47.8% $1.67, xhigh 53.1% $3.88; Opus 5.5 low 43.7% $1.17, medium 52.5% $2.91, high 56.0% $3.97; Grok 4.7 low 33.1% $1.58, against Grok 4.6 low's 33.4% $2.25. Sonnet 5 scored below all of these (24.1–34.1%). Cost per task is the best stand-in for weekly-limit use.
- **Artificial Analysis index**: Opus 5.5 low scores 42 using 20M output tokens, Sonnet 5.5 medium 41 using 29M ([Opus low](https://artificialanalysis.ai/models/claude-opus-5-5-low), [Sonnet medium](https://artificialanalysis.ai/models/claude-sonnet-5-5-medium)).
- **Weekly limits are one cap shared across Claude models**, with no published weighting by model or effort ([Max plan](https://support.claude.com/en/articles/11049741-what-is-the-max-plan), [best practices](https://support.claude.com/en/articles/9797557-usage-limit-best-practices), [how limits work](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work)).
- **Grok 4.7 is in Cursor's "Cursor Models" pool**, which resets monthly; past it, usage is on-demand at API rates ([usage limits](https://cursor.com/help/models-and-usage/usage-limits), [models and pricing](https://cursor.com/docs/models-and-pricing)). Cursor publishes no weighting by effort. Grok 4.7 has low, medium, high and xhigh effort ([reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning)); low scored below Sonnet 5.5 low on CursorBench, and xAI publishes no SWE-bench score ([announcement](https://x.ai/news/grok-4-7)). Grok 4.6 broke style rules here, though before the rules were fleshed out; 4.7 has no record here yet.
- **Higher Claude effort writes more comprehensive comments**, against this repo's short-comment rule. Opus 5.5 medium matches the previous Opus at high on coding; low comes close for much less ([effort](https://platform.claude.com/docs/en/build-with-claude/effort), [prompting Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5), [model config](https://code.claude.com/docs/en/model-config)). Sonnet 5.5 tends to produce longer outputs than Opus 5.5 ([system card §6.1.2](https://www.anthropic.com/claude-sonnet-5-5-system-card)).
- **FrontierCode**, the closest benchmark to style-guide adherence, grades against a repo's guidelines and penalizes out-of-scope changes. Opus 5.5 leads it and scores best at medium ([Opus 5.5 system card §8.4](https://www.anthropic.com/claude-opus-5-5-system-card)). Sonnet 5.5 scores 52.1% at xhigh and 46.2% at max, against Opus 5.5's 54.4% ([Sonnet 5.5 system card §8.4](https://www.anthropic.com/claude-sonnet-5-5-system-card)).
- **Sonnet 5.5's constraint behavior** improves on Sonnet 5 on nearly every misalignment metric, but Opus 5.5 is strictly better on approval-gate bypass and circumventing constraints ([system card §6.2.5](https://www.anthropic.com/claude-sonnet-5-5-system-card)). Sonnet 5 listed scope creep and rationalizing around an explicit constraint ([system card](https://www.anthropic.com/claude-sonnet-5-system-card)).
- **Sonnet 5.5** was released 2026-09-28 at $2/$10 per million input/output tokens and a 1M-token max context window, with low, medium, high, xhigh and max effort ([announcement](https://www.anthropic.com/claude-sonnet-5-5)).

## What no benchmark covers

No public benchmark measures style-guide adherence for these models, and none of the three has an [IFEval or IFBench](https://artificialanalysis.ai/evaluations/ifbench) score. Grok's adherence evidence is only unofficial forum posts. The outcome log below is the evidence that decides Grok's and Sonnet's boundaries. Sonnet 5.5's FrontierCode scores at low through high were not found.

## When a new model version ships

1. Update the pinned versions under [Based on](#based-on).
2. Re-run the research brief.
3. Re-check each boundary against the new evidence and the outcome log.
4. Bump the reviewed date.

Research brief: "For each current model: API price, context window and release date. What each effort level changes, and the vendor's guidance on it. Coding benchmarks at each effort level, with cost or tokens per task, preferring one harness that covers every pair. Any evidence on following a written style guide or repo conventions. Primary sources first; mark non-primary; no invented numbers; list unknowns."

## Outcome log

One row per landed issue, added by the landing wrap-up; keep the most recent ~20. Pass means merged without a style or scope fix. Peak context is the highest `/context` the implementing session reached.

| Issue | Pair | Peak context | Result | What review caught |
| --- | --- | --- | --- | --- |
| #70 | Opus high | 420K | Fix | Fixes were needed |
| #78 | Opus high | 170K | Pass | — |
| #69 | Opus high | 447K | Pass | — |
| #68 | Opus medium | 348K | Pass | — |
| #176 | Opus medium | 99K | Pass | — |
| #43 | Sonnet 5.5 | 205K | Fix | A few things needed correcting; perhaps should have been two issues |
| #174 | Opus medium | 80.5K | Pass | — |
| #42 | Opus medium | 109K | Pass | — |
| #41 | Opus medium | 129K | Fix | Small fixes needed |
| #173 | Opus medium | 116K | Pass | — |
| #40 | Sonnet high | 90K | Pass | — |
| #172 | Opus medium | 105K | Pass | — |
| #39 | Opus medium | 106K | Pass | — |
| #171 | Opus medium | 135K | Pass | — |
| #175 | Sonnet medium | 69.4K | Pass | — |
| #7 | Opus medium | — | Pass | Opus low might have worked |
| #23 | Opus medium | — | Pass | — |
| #5 | Opus medium | — | Pass | — |
| #22 | Opus medium | — | Pass | — |
| #21 | Opus medium | ~200K | Fix | A few things had to be fixed; the agent's context window was almost 200K |
