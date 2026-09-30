@AGENTS.md

## Claude Code

- **Start sessions at the repo root.** Settings, hooks and the project agent load only from the root `.claude/`; a session started in `packages/*` has none of them, so tell the operator to restart at the root ([`docs/claude-code-guardrails.md`](./docs/claude-code-guardrails.md)).
- **Delegating** to a subagent, `repo-explorer` included: [`docs/agents/delegation.md`](./docs/agents/delegation.md).
- **A read-count nudge**: write findings down with `file:line`. A finished diagnosis gets a handoff before implementation starts ([`docs/agents/planning.md`](./docs/agents/planning.md#handoffs)).
