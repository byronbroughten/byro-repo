# Functional vs. imperative idioms: examples

Disclosed from [`docs/code-style.md`](../code-style.md), "Functional vs. imperative idioms". The rules are there, one line each; this file holds the examples.

## `reduce` builds a new object

`reduce` builds a new object or record in place of a manual loop with a declared accumulator. The seed is a fresh `{}`, `new Map()` or `[]`, and each step mutates it and returns it: `(acc, item) => { acc[key] = ...; return acc; }`. Spreading it, `({ ...acc, ... })`, copies the whole accumulator on every item, which makes the build O(n²).

## Mutators return `this`

A mutator method returns `this` so calls chain: `fetchAndUpdateAll(): this { ...; return this; }`.

## A combined option is built from its parts

`prepFetch`'s `"all"` case calls itself for `"headers"`, `"actions"` and `"data"` rather than repeating their bodies.

## State is a named flag, not a trick

`lazy` tracks "already computed" with `let ready = false` and `if (!ready) { value = make(); ready = true; }`. It doesn't use `made ??= { value: make() }`, which needs a box to tell "computed as `undefined`" from "not computed" and hides that reason. The flag version is a few lines longer, but a reader doesn't have to derive why it's shaped that way.
