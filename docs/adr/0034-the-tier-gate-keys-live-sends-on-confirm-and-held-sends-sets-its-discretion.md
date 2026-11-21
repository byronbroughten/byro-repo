# The tier gate keys live sends on `--confirm`, and `heldSends` sets its discretion

The framework promises that only a command holding `--confirm` can lose entered data ([sheets-framework ADR 0034](../../packages/framework/docs/adr/0034-hold-entered-data-loss-at-the-node-hosts-adapter-until-a-hash-bound-confirm.md)), so the tier gate reads that from the command text and needs no other live-send row: an `app:sync` or `app:chore` holding `--confirm` is tier 3, and a send without it is tier 2. So don't add a gate row that classifies a send's plan; the framework already holds it.

## Decision

- **The `heldSends` setting at `agentDiscretion` frees an app `--confirm` in an Interactive session**; [the agent's rule for a held send](../targets-and-gates.md#the-agents-rule-for-a-held-send) still applies, so the held list still traces to what the developer agreed in the session.
- **`--force` stays tier 3 under discretion**: a force overwrites a person's edit, which no held list covers.
- **A runner step's `--confirm` stays refused under discretion**: a step has no developer in the session to agree to a held item, so it records a `denied-tool` blocker with the ready command instead.
- **`heldSends` is read only from the key `BYRO_HELD_SENDS` in the `env` block of the primary checkout's `.claude/settings.local.json`**, never the process environment. The agent can't write that file, so it can't grant itself discretion, and a workspace has no copy, so every workspace reads the developer's one setting. A call naming the setting outside the box asks, as an inline setting would otherwise slip past.

The rows themselves are in [the tier list](../targets-and-gates.md#which-tier-an-action-is-in).

Source: byronbroughten/byro-repo#564, byronbroughten/byro-repo#882, byronbroughten/byro-repo#883, byronbroughten/byro-repo#884
