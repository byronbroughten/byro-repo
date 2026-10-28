# Functional vs. imperative idioms: examples

Disclosed from [`docs/code-style.md`](../code-style.md), "Functional vs. imperative idioms". The rules are there, one line each; this file holds the examples and the why.

## `reduce` builds a new object

`reduce` builds a new object or record in place of a manual loop with a declared accumulator. The seed is a fresh `{}`, `new Map()` or `[]`, and each step mutates it and returns it: `(acc, item) => { acc[key] = ...; return acc; }`. Spreading it, `({ ...acc, ... })`, copies the whole accumulator on every item, which makes the build O(n²).

## Mutators return `this`

A mutator method returns `this` so calls chain: `fetchAndUpdateAll(): this { ...; return this; }`.

## A combined option is built from its parts

`prepFetch`'s `"all"` case calls itself for `"headers"`, `"actions"` and `"data"` rather than repeating their bodies.

## `if`/`else` over a ternary

A ternary stays only for a single trivial value pick with no side effects. One inside `${}` must also fit on one line; otherwise it becomes a named local, so the template reads as text with names in it.

## State is a named flag, not a trick

A wrapper object or a compact operator makes the reader reconstruct what state it encodes; a named variable and an explicit `if` state it. `lazy` tracks "already computed" with `let ready = false` and `if (!ready) { value = make(); ready = true; }`. It doesn't use `made ??= { value: make() }`, which needs a box to tell "computed as `undefined`" from "not computed" and hides that reason. The flag version is a few lines longer, but a reader doesn't have to derive why it's shaped that way.
