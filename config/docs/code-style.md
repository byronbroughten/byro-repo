# Coding style

Distilled from the author's own refactors of AI-generated code, plus a survey of a codebase for consistent, repeated patterns. This file covers general TypeScript code _shape_; a project's own rules layer on it.

One line per rule. The reasoning and worked examples are one file away. Open a reasoning file only when you're changing the rule, or the rule's line doesn't decide your case.

## Reasoning files

| When | File |
| --- | --- |
| Placing a member, a helper or a class | [`docs/code-style/class-shape.md`](./code-style/class-shape.md) |
| Naming a value, method, flag, getter or param bag | [`docs/code-style/naming.md`](./code-style/naming.md) |
| A type-level choice, a lookup table, a named type | [`docs/code-style/type-modeling.md`](./code-style/type-modeling.md) |
| A shared message phrase, a skip-and-log | [`docs/code-style/error-handling.md`](./code-style/error-handling.md) |
| Writing or changing a test | [`docs/code-style/tests.md`](./code-style/tests.md) |
| A comment, or a file-level navigation block | [`docs/code-style/comments.md`](./code-style/comments.md) |
| `reduce`, a chaining mutator, a combined option | [`docs/code-style/idioms.md`](./code-style/idioms.md) |
| Imports, barrels, file names | [`docs/code-style/file-organization.md`](./code-style/file-organization.md) |

## Class shape

- **Extract the shared piece when you can name the second caller**, not when it arrives.
- **Member order:** `static init()`, then collaborator getters, then public behavior methods, then `_`-prefixed private helpers — a single-caller helper sits right after its caller.
  - **A private helper that never reads `this` is an unexported module function below the class, not a `_` method**, ordered by first use. A helper that reads `this` only to reach a collaborator stays a method.
  - **A helper whose arguments are one collaborator and its state belongs on that collaborator.** A public method that doesn't read `this` stays put; a helper that only renames a function in scope is deleted.
  - **Helpers sharing a subject and passing nothing between them become an object bundle; helpers passing one value around become a helper class** in its own file.
- **Delete dead scaffolding in a file you touch**, but **ask before deleting commented-out code.** Zero callers is a list of candidates, not a verdict.
- **A "why" comment carries over verbatim across a restructure.**
- **One class per file, custom `Error` subclasses included.** Lint backs it.

## Naming

- **Prefer a term from TS/JS's own vocabulary over a made-up adjective.**
- **Name a value after the domain type it holds, not a generic container word.**
- **A boolean is a third-person statement about its subject, never a bare adjective.** It defaults to `false`, so it appears only where it changes something.
  - **A flag in a config literal is the exception: it is an imperative directive to whatever reads the literal**, one mood per literal.
- **A plural method name promises more of the same return, not a different container.**
- **Trim a method name to what the return type doesn't already say.**
- **A name has to read to someone who has never opened this codebase** — never jargon named after the mechanism that sets it.
- **A constant is camelCase; two or more in one file that serve one purpose become one `as const` object named for that purpose.** Lint backs the camelCase half.
- **A getter is a cheap, no-arg, side-effect-free, one-expression pass-through.** Anything that takes an argument, has a side effect, or loops/branches to compute its answer is a called method. A value fixed for the object's whole lifetime is a plain field, not a getter.
- **`_` prefix means "narrow-purpose, not general API"**: a true `private` helper, or a step a coordinating class must call that TS won't let you mark `private`.
- **Destructure params into a named type at 3+ params, 2+ params of one type, or when a named type for the bag already exists**; otherwise stay positional. The one argument every implementation will use is hoisted out of the bag and passed first. The same grouping judgment applies to fields.

## Comments

- **Default to no comments.** When a block would need a comment saying _what_ it does, pull it into a small private method whose name says it.
- **A comment is one line, trailing or immediately above its line, and explains a "why not the obvious thing"**, never restating the line. A why that doesn't fit on one short line goes in the commit message or PR description.
- **The one multi-line exception is a file-level navigation block**, 5–10 lines above the exported class stating the file's job and where neighbouring work lives.

## Error handling & validation

- **A phrase that names the same thing in several messages or labels comes from one function.**
- **Default to a plain `throw new Error("specific message")`.** Mint a custom `Error` subclass only when callers need to catch the failure _category_ by type.
- **Guard-clause throws, never nested conditionals.** The one accepted exception is an exhaustiveness check, which ends in a trailing `else { throw new Error(...) }`.
- **Trace whether a "shouldn't happen" condition is actually reachable before defaulting to skip-and-log**; if upstream already guarantees it can't happen, throw.

## Type modeling

- **`type` for everything computed from other types.** A plain object shape is an `interface`; lint enforces it.
- **Generic params get two-letter domain abbreviations with a constraint**; bare `T`/`K`/`V`/`O` are only for domain-free utilities and tests; lint checks the two letters, not the constraint.
- **`undefined` is the one "absent" value; `null` appears only where an external API's types or JSON carry it.**
- **Narrow a type until the empty case can't arise, rather than a branded-string fallback.**
- **A per-kind lookup table is keyed by the finite union its producer returns, never a `switch` with a `default` over a wider type.**
- **An optional parameter that switches a function to a second job means it should be a second function.** Don't add an overload to loosen a constraint for one caller.
- **Use the named type that already exists instead of an inline shape**, for a field or return type as well as a param bag.

## Functional vs. imperative idioms

- **`forEach` only for side effects, `map` only for pure transforms — never mixed.**
- **`forEach` by default; `for…of` only when the body exits early (`break`, `continue`, `return`) or destructures `Map` entries; `for…in` only in a project's structural utilities.**
- **`reduce` is fully accepted** for building a new object/record, rather than a manual loop with a declared accumulator: seed a fresh `{}`, `new Map()` or `[]`, mutate it and return it.
- **`flatMap` returning `[]` or `[x]` filters and maps in one pass** when the map needs the narrowed value.
- **Mutator methods return `this` for chaining.**
- **A helper returns what it produces; no output parameters.**
- **Standalone units are `function`/`export function` declarations.** Arrow functions appear only as inline callbacks; lint backs it outside tests.
- **An option that combines other options is built from them, not from copies of their bodies.**
- **`if`/`else` over a ternary for anything beyond a single trivial value pick** with no side effects; a ternary inside `${}` must also fit on one line, or it becomes a named local.
- **Encode state as a named variable and an explicit `if`, not a wrapper object or a compact operator whose meaning the reader has to reconstruct.** `??=` is for filling in a default, not for "computed yet?" tracking.

## Tests

- **A test sits beside what it tests (`Foo.test.ts`).**
- **Assert the outcome a caller can observe, not the calls made to reach it.** A call count stands only where the count is itself the contract.

## Tooling

- **Hooks, scripts and tool configs follow this file too.**

## Imports & file organization

- **No barrel/index files** apart from a package's declared public entries.
- **File naming:**
  - PascalCase mirroring the exported class name.
  - A short PascalCase abbreviation for a file exporting one static-bundle object of related functions. A fat bundle's pieces split into a same-named subfolder and are re-assembled in the parent file.
  - camelCase for plain data/config or entry-point files.
  - A long module's helpers split by subject into a same-named subfolder of camelCase files, each exporting camelCase bundles written with method shorthand.
