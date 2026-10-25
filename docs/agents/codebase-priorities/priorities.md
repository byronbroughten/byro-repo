# Priorities

The existing rules that show each Tier 2 priority, and why security, undo and data integrity are a floor. Pointers only: each rule keeps its one home.

## Developer attention

- The review list collapses the agreed Dismisses, with no checkboxes, so the developer reads only what needs a decision: `runner/src/reviewList.ts:227`.

## Fewest concepts

- Helpers passing one value around become a helper class: [`config/docs/code-style.md:26`](../../../config/docs/code-style.md#class-shape).
- A helper whose arguments are one collaborator and its state moves onto it, and a helper that only renames is deleted: [`config/docs/code-style.md:25`](../../../config/docs/code-style.md#class-shape).
- A parameter its only caller already holds as state makes the query the instance's: [`packages/framework/docs/code-style.md:26`](../../../packages/framework/docs/code-style.md#class-shape).
- An optional parameter's second job becomes a second function: [`config/docs/code-style.md:70`](../../../config/docs/code-style.md#type-modeling).
- Use the named type that already exists: [`config/docs/code-style.md:71`](../../../config/docs/code-style.md#type-modeling).
- Extract only at a named second caller: [`config/docs/code-style.md:22`](../../../config/docs/code-style.md#class-shape).
- Delete dead scaffolding: [`config/docs/code-style.md:27`](../../../config/docs/code-style.md#class-shape).
- One home per fact: [`docs/prose-style.md:19`](../../prose-style.md#one-home-per-fact).
- The boundary, "not the fewest characters": an explicit `if` over a compact operator whose meaning the reader has to reconstruct: [`config/docs/code-style.md:84`](../../../config/docs/code-style.md#functional-vs-imperative-idioms).

## Agent cost

- [Keep the payload on disk and the summary in context](../../agent-behavior-design.md#keep-the-payload-on-disk-and-the-summary-in-context).

## Code run-time

- Sheets round trips are the app's cost: [`round-trips.md`](../../../packages/framework/docs/architecture/round-trips.md).
- `tsc`'s cost per typed change: [`type-check-cost.md`](../../../packages/framework/docs/architecture/type-check-cost.md).

## Why the floor is a floor

A loss of security, undo or data integrity is often the kind no undo fixes. The cost-to-undo tiers in [`targets-and-gates.md`](../../targets-and-gates.md#which-tier-an-action-is-in) already gate actions; the floor covers Recommendations that would weaken those gates or make data harder to recover.
