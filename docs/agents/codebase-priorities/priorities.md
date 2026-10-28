# Priorities

The existing rules that show each Tier 2 priority, why fewer concepts help, and why security, undo and data integrity are a floor. The rule lists are pointers only: each rule keeps its one home.

## Developer attention

- The review list collapses the agreed Dismisses, with no checkboxes, so the developer reads only what needs a decision: `runner/src/reviewList.ts:227`.

## Fewest concepts

Each name, parameter, layer, shape or copy of a fact is one more thing a reader holds, so fewer keep the code comprehensible and easy to change.

- Helpers passing one value around become a helper class: [`config/docs/code-style.md#class-shape`](../../../config/docs/code-style.md#class-shape), **Helpers sharing a subject and passing nothing between them**.
- A helper whose arguments are one collaborator and its state moves onto it, and a helper that only renames is deleted: [`config/docs/code-style.md#class-shape`](../../../config/docs/code-style.md#class-shape), **A helper whose arguments are one collaborator and its state**.
- A parameter its only caller already holds as state makes the query the instance's: [`packages/framework/docs/code-style.md#class-shape`](../../../packages/framework/docs/code-style.md#class-shape), **A composition of collaborator calls that answers one domain question**.
- An optional parameter's second job becomes a second function: [`config/docs/code-style.md#type-modeling`](../../../config/docs/code-style.md#type-modeling), **An optional parameter that switches a function to a second job**.
- Use the named type that already exists: [`config/docs/code-style.md#type-modeling`](../../../config/docs/code-style.md#type-modeling), **Use the named type that already exists**.
- Extract only at a named second caller: [`config/docs/code-style.md#class-shape`](../../../config/docs/code-style.md#class-shape), **Extract the shared piece when you can name the second caller**.
- Delete dead scaffolding: [`config/docs/code-style.md#class-shape`](../../../config/docs/code-style.md#class-shape), **Delete dead scaffolding in a file you touch**.
- One home per fact: [`docs/prose-style.md#one-home-per-fact`](../../prose-style.md#one-home-per-fact), **Each file has one job**.
- The boundary, "not the fewest characters": an explicit `if` over a compact operator whose meaning the reader has to reconstruct: [`config/docs/code-style.md#functional-vs-imperative-idioms`](../../../config/docs/code-style.md#functional-vs-imperative-idioms), **Encode state as a named variable and an explicit `if`**.

## Agent cost

- [Keep the payload on disk and the summary in context](../../agent-behavior-design.md#keep-the-payload-on-disk-and-the-summary-in-context).

## Code run-time

- Sheets round trips are the app's cost: [`round-trips.md`](../../../packages/framework/docs/architecture/round-trips.md).
- `tsc`'s cost per typed change: [`type-check-cost.md`](../../../packages/framework/docs/architecture/type-check-cost.md).

## Why the floor is a floor

A loss of security, undo or data integrity is often the kind no undo fixes. The cost-to-undo tiers in [`targets-and-gates.md`](../../targets-and-gates.md#which-tier-an-action-is-in) already gate actions; the floor covers Recommendations that would weaken those gates or make data harder to recover.

A gain above the floor is only a Tier 2 gain, so the containment [ADR 0007](../../adr/0007-keep-untrusted-text-out-of-instructions-and-defer-containment.md) defers stays deferred.
