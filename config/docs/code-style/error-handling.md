# Error handling: reasoning and examples

Disclosed from [`docs/code-style.md`](../code-style.md), "Error handling & validation". The rules are there, one line each; this file holds the why.

## One function for a shared phrase

A phrase that names the same thing in several messages or labels comes from one function, so the wording can't drift between them. A `columnLabel(table, column)` used by every error and log line that names a column is the example.

## Throw instead of skip-and-log

A defensive skip earns its place only when the condition can genuinely occur in valid, expected state. If upstream code already rules it out (a prior step corrects or prunes exactly this case), skip-and-log just buries a real failure in a log line. Throw instead. Example: `Table.columnEntries()` skipped rows missing `header`/`valueName`/a resolvable `tableId`. But `_correctHeaders` fixes `header` for every active row, the emit step samples `valueName` from the live column, and `_pruneRows` guarantees every surviving row's `tableId` resolves. So a row still failing one of those checks means the sync didn't actually complete, and now it throws.
