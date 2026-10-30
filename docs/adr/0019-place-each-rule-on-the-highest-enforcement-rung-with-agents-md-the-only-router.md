# Place each rule on the highest enforcement rung, with AGENTS.md the only router

Agents had two overlapping routers, in AGENTS.md and README, `src/`-only rules loaded on every task from the root AGENTS.md, and few rules were checked by a tool. So every rule goes on the highest rung it can reach: lint, then path-triggered (a nested `AGENTS.md`, a hook), then a router pointer, then prose: the tier import rule became a lint, as did checks that links resolve and every nested `AGENTS.md` has its `CLAUDE.md`. Hooks only reinforce, since they are Claude-only, so every folder-scoped rule lives in a nested `AGENTS.md`, paired with a one-line `CLAUDE.md` importing it. AGENTS.md is the only router and its root keeps only what applies to every task; README is for humans, and its agent-relevant facts moved to their homes.

Source: byronbroughten/byro-repo#108

## Considered Options

- **Put folder rules in Claude hooks.** Rejected: Codex and Cursor never see them.
- **Keep README as a second router.** Rejected: routing agents through a 30 KB pitch cost more than the few facts they needed from it.
