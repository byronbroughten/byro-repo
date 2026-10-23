# Gate agent actions by what they cost to undo

Gates built a rule at a time asked for actions that were cheap to undo, such as every `app:*` write, every Docs write without a Deliverable grant and every commit, while a push that could leak a secret to a public repo got no more protection than a sheet edit. One gate decision now sorts every tool call into three tiers: free when git can undo it, free when Google's version history is the undo point (`app:*` and `dev:*` live commands, and creating or writing a file one of the developer's accounts owns), and an ask for anything that can't be undone or reaches someone else, such as a raw push, `npm publish`, a sharing change, a write to another owner's file, spending money or touching credentials. The gates are designed against a well-meaning agent that makes a mistake, since a stalled run or a stopped implementation had cost more than any action an agent took.

Source: byronbroughten/byro-repo#273, byronbroughten/byro-repo#274, byronbroughten/byro-repo#276

## Consequences

- Quality checks and cost guards are not gates, and the tiers leave them alone: lint feedback, the style gate, the formatter, the read guards and the generated-file read deny.
- A sharing or permission change always asks, naming who and at what permission, and a failed owner lookup counts as someone else's file, so it asks too.
- `app:chore <name> -- --send` runs free only after that chore's dry run in the same session, and a command naming no target, a bare `clasp` or `npx sheets-framework`, still asks.
- `pinnedTargetGuard` and `docGrantGuard` were retired, and hardening against the agent itself waits for [ADR 0007](./0007-keep-untrusted-text-out-of-instructions-and-defer-containment.md#consequences)'s containment triggers.
