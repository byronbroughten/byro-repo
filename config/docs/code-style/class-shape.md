# Class shape

Style fragment. The one-line rules live in [`docs/code-style.md`](../code-style.md); this file holds the reasoning and the worked examples.

One heading per class-shape rule, most of them with the refactor that produced it: grep `^## ` for the rule you're applying and read that section.


## Extract the shared piece when the second caller is foreseen, not when it arrives

Keeping a helper private until a second call site actually exists is the wrong default here. When the sibling caller is already visible — another table of the same shape, another handler of the same family — build the shared class now and put it beside its siblings. A name-to-ID resolver that two handlers obviously want is written as a general class for its first caller. The same judgment governs behaviour a caller asks for: build the general form rather than the one fitted to the caller that asked, so per-row reporting serves any handler instead of only the batch one that motivated it. This is not licence to build for imagined callers; a feature nobody has asked for still waits. The test is whether you can name the second caller.

## Class member order

1. `static init()`
2. Plain getters for derived collaborators/state (`schema`, `client`, ...)
3. Public behavior methods
4. Private helpers, `_`-prefixed — ordered so a helper used by only one caller sits immediately after that caller (detail follows the step that needs it); a helper reused by several later methods comes first, in the order of its first use. (`_loadAccess`/`_hasAccess`, each used by multiple methods, sit first; `_pruneRows`, called only by `_syncRows`, sits directly after it.)

## A helper that never reads `this` is a module function

A private helper with zero references to `this` depends on nothing the instance holds, so it leaves the class: an unexported function below the class, with the moved functions ordered by their first use in the class. Every private helper left in the class body then depends on instance state, and a reader can tell the two kinds of helper apart without reading each body. Keeping it unexported means the move doesn't widen the module's interface. A random-suffix generator that never touched the instance began as a private method on a schema class and became such a function.

- **A helper whose arguments are one collaborator and that collaborator's state belongs on the collaborator**, not below the class. `Report._finalizeRows(table, state)` became `Table.finalizeRows()`.
- **A helper that reads `this` only to reach a collaborator stays a method.** Moving it out would mean passing the collaborator in, which is the threading this file warns against.
- **A public method that happens not to read `this` stays put.** It is part of the class's interface, not a helper.
- **A helper that only renames a function already in scope is deleted**, and its callers call that function. `Schema.config` wrapped the imported `configGet` with the same signature.
- **Helpers that share a subject and pass nothing to each other become an object bundle** named for the subject and written with method shorthand, so the names shorten and the group reads as one unit (`color.fromRgb`, `rows.index`).
- **Helpers that keep passing the same value to each other become a helper class** that holds the value, in its own file, so their signatures stop threading it. A project that builds collaborators a particular way says so in its own style doc.

## Delete dead scaffolding you touch — with one exception

Editing a file is the moment to remove, not preserve, a stub nothing calls, a placeholder function (`function triggerAuth(): void { return; }`), or a variable instantiated and discarded (`const parser = Parser.init();` with no use of `parser`). An empty function body is better than a dead unused variable or an unreferenced helper kept "in case."

**Exception: commented-out code.** Flag it and ask before deleting — don't remove it as part of a cleanup pass. It might be an intentional breadcrumb rather than leftover cruft.

**Zero callers is not proof of dead.** Some members are parked for planned work and carry no marker distinguishing them from cruft: a `Table.clearIndexStale` or a `requestSort` that nothing calls yet may be intentional. A grep-derived list of uncalled members is a set of candidates, not a verdict: name what you found and ask, rather than deleting on the count. A member whose only caller is a test is a third case again — deleting it deletes coverage.

## One class per file

A file named for a class holds only that class, so the file name tells a reader everything in it. There are no exceptions, custom `Error` subclasses included; `max-classes-per-file` enforces it. A helper type or free function that serves one class lives in that class's file.

Splitting a class family can close an import cycle through an `extends` clause, which fails at load time because the base class isn't defined yet when the subclass file runs.

## Keep "why" comments across a refactor

A comment explaining a non-obvious invariant (e.g. why two tables must be written in one transaction) carries over verbatim across a restructure — it documents the invariant, not the code shape around it.

