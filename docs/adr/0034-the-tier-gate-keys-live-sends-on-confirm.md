# The tier gate keys live sends on `--confirm`

The framework promises that only a command holding `--confirm` can lose entered data ([sheets-framework ADR 0034](../../packages/framework/docs/adr/0034-hold-entered-data-loss-at-the-node-hosts-adapter-until-a-hash-bound-confirm.md)), so the tier gate reads that from the command text and needs no other live-send row. So don't add a gate row that classifies a send's plan: the framework already holds it. The rows are in [the tier list](../targets-and-gates.md#which-tier-an-action-is-in).

## The `heldSends` discretion and what stays enforced

- **The `heldSends` setting lets the developer free an app `--confirm` in an Interactive session**, since the agent's rule for a held send still ties each held item to what the developer agreed there.
- **`--force` stays enforced**, since no held list covers a person's edit it overwrites.
- **A runner step's `--confirm` stays refused**, since a step has no developer in the session to agree to a held item.
- **The setting lives in the primary checkout's `.claude/settings.local.json`**, since the agent can't write that file, so it can't grant itself discretion, and a workspace has no copy, so every workspace reads the developer's one setting.

Source: byronbroughten/byro-repo#564, byronbroughten/byro-repo#881, byronbroughten/byro-repo#882, byronbroughten/byro-repo#883, byronbroughten/byro-repo#884
