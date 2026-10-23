---
status: accepted
---

# Keep Untrusted text out of agents' instructions with mechanical checks, and leave containment for later

Four of the developer's repos are public, and one prompt sentence was all that kept an agent from acting on a stranger's issue text. Agents act only on [Trusted text](../../runner/GLOSSARY.md), enforced where text enters: runner steps read issues only through `npm run issue:read` with `--hide-others`, which labels each part, and the runner refuses a body another login wrote or edited. Containment, so that a step can't do harm even after it is misled, waits, since no stranger has commented yet.

Source: byronbroughten/byro-repo#268, byronbroughten/byro-repo#269

## Consequences

- Containment is built, and this ADR is superseded by the one recording it, when any one of these happens:
  1. The runner starts working tickets the developer didn't write.
  2. A runner step gains web access, or access to content someone else can edit or comment on.
  3. Untrusted text is caught trying to instruct an agent.
- No Drive-permission check is added, because sharing a Doc or Sheet already needs its own yes ([the tier list](../targets-and-gates.md#which-tier-an-action-is-in)).
- A Sheet's cell values are always data, even in a Sheet only the developer can edit.
- A merge to master is where text becomes trusted: content committed to master in one of the developer's repos is Trusted text, and a branch is not until it lands.
