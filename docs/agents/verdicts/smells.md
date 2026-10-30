# Smells: reasoning and examples

Disclosed from [`docs/agents/verdicts.md`](../verdicts.md). The rules are there, one line each; this file holds the examples and the why.

## Fix or explain

A smell is a heuristic, so some code that trips one is forced on it: a library's or API's required shape, or generated code. "Never allowed" would be wrong, and "always optional" leaks, because whatever acts on a review leaves an optional finding alone. So a smell is fixed by default, and one an external constraint forces carries its reason at its site, where the next reader sees it before "fixing" it. A pattern the repo wants for its own design reasons belongs in a documented standard or an approved exception, which suppress the smell everywhere, not in a keep at one site.

## When a kept smell's reason goes stale

Re-check a kept smell's reason when a change touches its site or what the reason relies on: the same function, a type it names, a spec decision it cites. A reason that's no longer true protects nothing.

## Approved exceptions

A reason the developer approves more than once becomes an exception in the verdict rules, and the review stops flagging that pattern.

The Speculative Generality exception covers only the library packages because their consumers live outside them, so a public member's caller may not exist yet. In an app package (real-estate, runner) every caller is in reach, so a caller-less public member is flagged; an older one found there predates the branch, so it is a Propose `ticket`.

The Middle Man exception keeps a name like `type SheetGid = number`, which says what the number means at every site that uses it. Middle Man is defined for classes and functions, but read loosely it would cut the alias for passing straight through to `number`; the alias is the cure for Primitive Obsession, so the exception names Middle Man as the smell it suspends.
