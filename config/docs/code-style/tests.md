# Test code style

Disclosed from [`docs/code-style.md`](../code-style.md).

**This is a draft, not settled like docs/code-style.md; docs/code-style.md's Tests section holds the settled test rules.** Every docs/code-style.md rule was mined from a file the author refactored personally; test files haven't had that pass yet, so `*.test.ts` doesn't represent the house style. These rules are proposed extensions in the same spirit. Revisit them once a real test file has been through the author's own refactor, the way production code was.

All of docs/code-style.md applies to test code as-is.

## Outcomes over calls

The settled rule in `docs/code-style.md` asks a test to assert what a caller can observe: a return value, the state a fake is left in, a message shown. A test that asserts which calls were made, how many, or with what arguments is coupled to the route the code takes, so it breaks when an internal refactor keeps the behaviour and passes when the calls are right but the outcome is wrong. A call count is the contract only when the count is what a caller pays for, such as round trips to a rate-limited API, and such a test says so in its name ("costs one read").

## Draft test rules

- **Understand a class from its implementation.** Open the sibling `Foo.test.ts` when changing tests.
- **Use a named setup function instead of a comment explaining a seeded row.** Instead of `// Pre-existing row for the "test" table, with API access so its column IDs get gathered` beside a literal, write `seedTableWithApiAccess()`, so the call site states the scenario.
- **One behavior per `it()`, named as a sentence describing the behavior, not the mechanism**: `"flushes table and column changes in a single batch call"`.
- **Name `describe` blocks after the real method or class under test**, not an invented suite label: `describe("syncAndFlush", ...)`, `describe("ColumnOperator.columnEntries / toFileSource", ...)`.
- **Assert precisely**: the exact resulting value or shape, not presence or truthiness.
