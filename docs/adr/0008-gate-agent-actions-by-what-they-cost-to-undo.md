# Gate agent actions by what they cost to undo

Gates built a rule at a time asked for cheap-to-undo actions, such as every `app:*` write and commit, though a stalled run cost more than any agent action, while a secret-leaking push got no more protection than a sheet edit. One gate decision now sorts every tool call into tiers: free when git or Google's version history can undo it (live `app:*`/`dev:*` commands, files the developer's accounts own), and an ask for anything that can't be undone or reaches someone else, such as a raw push, a publish, a sharing change, another owner's file, money or credentials. With Untrusted text kept out by ADR 0007, the gates guard against a well-meaning agent's mistakes.

Source: byronbroughten/byro-repo#273, byronbroughten/byro-repo#274, byronbroughten/byro-repo#276

## Consequences

- `pinnedTargetGuard` and `docGrantGuard` were retired; which action sits in which tier is [the tier list](../targets-and-gates.md#which-tier-an-action-is-in).
