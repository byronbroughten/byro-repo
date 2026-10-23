# Gate agent actions by what they cost to undo

Gates built a rule at a time asked for cheap-to-undo actions, such as every `app:*` write and commit, though a stalled run cost more than any agent action, while a secret-leaking push got no more protection than a sheet edit. One gate decision now sorts every tool call into tiers: free when git or Google's version history can undo it (live `app:*`/`dev:*` commands, files the developer's accounts own), and an ask for anything that can't be undone or reaches someone else, such as a raw push, a publish, a sharing change, another owner's file, money or credentials. With Untrusted text kept out by ADR 0007, the gates guard against a well-meaning agent's mistakes.

Source: byronbroughten/byro-repo#273, byronbroughten/byro-repo#274, byronbroughten/byro-repo#276

## Consequences

- A sharing or permission change always asks, naming who and at what permission, and a failed owner lookup counts as someone else's file, so it asks too.
- `app:chore <name> -- --send` runs free only after that chore's dry run in the same session, and a command naming no target, a bare `clasp` or `npx sheets-framework`, still asks.
- `pinnedTargetGuard` and `docGrantGuard` were retired, and hardening against the agent itself waits for [ADR 0007](./0007-keep-untrusted-text-out-of-instructions-and-defer-containment.md#consequences)'s containment triggers.
