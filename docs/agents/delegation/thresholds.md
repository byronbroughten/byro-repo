# Sweep thresholds: reasoning

Disclosed from [`docs/agents/delegation.md`](../delegation.md#sweep-thresholds). The table is there; this file holds the arithmetic behind each row.

## The break-even

A read of R tokens kept inline is carried in every later request, so over the T turns left in the session it costs about R × T. A `repo-explorer` spawn costs its own requests instead: about 6 turns from a ~22K first request, 132K, plus about 3R for the read carried over its turns, plus a reply of about 1.5K carried for the parent's T turns. Delegating is cheaper once R × T > 132K + 3R + 1.5K × T, so the threshold is R = (132K + 1.5K × T) / (T − 3).

The inputs:

- **T** is the median turns after a large read for the session's kind, in [the Reads line from byro-repo#859](../codebase-priorities/estimates.md#reads).
- **~22K** is a runner step's first request, in the same section's fixed-overhead line; a spawn starts cold the same way.
- **~6 turns** is a reviewer subagent's median turns in [Steps](../codebase-priorities/estimates.md#steps), the nearest measured cold spawn.
- **~1.5K** is `repo-explorer`'s reply cap, about 60 quoted lines at ~16 tokens a line, plus their `file:line` references ([its definition](../../../.claude/agents/repo-explorer.md#what-to-return)).

## Each row

| Kind | T | Break-even | Row |
| --- | --- | --- | --- |
| `/runner` | 49 | 4.5K | 5K |
| `/judge-findings` | 48 | 4.5K | 5K |
| Other sessions | 48 | 4.5K | the default, 5K |
| Implement step | 32 | 6.2K | 8K |
| `/code-tickets` | 28 | 7.0K | 8K |
| `/start-issue` | 25 | 7.7K | 8K |
| Resolve step | 24 | 8.0K | 8K |
| Review step | 9 | 24K | 25K |
| Gap check | 6 | 47K | inline |

Each row rounds its kinds' break-evens up to one figure. `/runner` and `/judge-findings` round to the default's 5K, so `delegation.md` lists them under it. The gap check's 47K is past any sweep it makes, so its row is inline. Kinds with 3 or fewer measured sessions are too few to set a row and fall under the default: `/code-spec`, `/wayfinder`, `/piece-tickets`, `/to-writing-style`, `/project-tickets`, `/review-tickets` and the red-checks step.

Agreed with the developer on byro-repo#859, 2026-11-19.
