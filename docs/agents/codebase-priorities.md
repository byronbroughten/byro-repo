# Codebase Priorities

What every Recommendation about the codebase or agent tooling is weighed against: a Tier 1 gate, a floor, and four ranked Tier 2 priorities. The terms are the [runner glossary](../../runner/GLOSSARY.md)'s; the developer changes these as what they value changes.

One line per rule. The reasoning and worked examples are one file away. Open a reasoning file only when you're changing the rule, or the rule's line doesn't decide your case.

## Reasoning files

| When | File |
| --- | --- |
| What a priority means in practice, the rules that express it, why fewer concepts help, why the floor is a floor | [`docs/agents/codebase-priorities/priorities.md`](./codebase-priorities/priorities.md) |
| Estimating a cost: reads, checks, command latency (gh, git, issue:start, wrap-up), type-check, Sheets calls, tickets | [`docs/agents/codebase-priorities/estimates.md`](./codebase-priorities/estimates.md) |

## Scope

- **They cover Recommendations about the codebase and agent tooling: hooks, runner, skills, agent docs.** Pieces and other reader-facing prose follow the writing-voice and writing-craft docs instead.

## Tier 1: the gate

- **A Recommendation meets the user stories, maintenance and tests included; no Tier 2 gain buys back a failed story.**
- **The developer's decisions stay theirs.**
- **Removing a decision point or an alignment check (a review, a required doc read, a gate) is a Tier 1 change**: it may be recommended, always flagged as one, never justified by Tier 2 savings.
- **Attention and agent cost are saved only by removing work that isn't a decision**: rubber-stamp asks, re-explaining, manual steps, noise in a report.

## The floor

- **Security, undo and data integrity are never weakened without saying so; any weakening is named and left to the developer, never settled by Tier 2 gains.**
- **Weakening security**: letting Untrusted text into an agent's instructions, exposing a credential or token more widely, moving an action to a cheaper gate tier, or adding an outward action that can't be undone.
- **Weakening undo**: making an action harder to undo.
- **Weakening data integrity**: putting live-sheet data where version history can't recover it.
- **A gain above the floor is weighed as a Tier 2 gain.**

## Tier 2: ranked

- **In order: developer attention, fewest concepts, agent cost, code run-time.**
  1. **Developer attention**: the decisions, approvals, manual steps and reading a Recommendation asks of the developer.
  2. **Fewest concepts**: the fewest names, parameters, layers, shapes and copies of a fact a reader has to hold; not the fewest characters.
  3. **Agent cost**: the tokens a session reads and carries, and the wall-clock time it spends.
  4. **Code run-time**: the wall-clock time of code: app runs, mostly Sheets round trips, plus `tsc`, tests and scripts.
- **A large gain lower down can offset a small loss higher up.**
- **Aim to satisfy them together.**

## Explaining a tradeoff

- **A Recommendation that wins or ties on every priority says nothing about them.**
- **One that gives a priority up names it in one line, with a realistic estimate**, or `no estimate: <how to get one>` when none exists; never an invented number.
- **A measurement stays in its source beside its conclusion, and the Estimates only index it**; one with no conclusion to sit beside, or whose conclusion is a rule line, is recorded in the Estimates with its date.
- **Whoever records a new measurement at its source adds its line to the Estimates.**
