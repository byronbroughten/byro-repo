@AGENTS.md

## Claude Code

- **Start sessions at the primary root, or a workspace's root.** Settings, hooks and the project agent load only from a root's `.claude/`; a session started in `packages/*` has none of them, so tell the operator to restart at the primary root or the workspace's ([`docs/claude-code-guardrails.md`](./docs/claude-code-guardrails.md)).
- **Delegating** to a subagent, `repo-explorer` included: [`docs/agents/delegation.md`](./docs/agents/delegation.md).
- **A read-count nudge**: write findings down with `file:line`. A finished diagnosis gets a handoff before implementation starts ([`docs/agents/planning.md`](./docs/agents/planning.md#handoffs)).
