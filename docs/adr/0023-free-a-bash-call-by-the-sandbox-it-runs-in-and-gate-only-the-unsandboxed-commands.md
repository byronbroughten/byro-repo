---
status: partly superseded by ADR-0024, amended by #547 for `gh` and `git push`
---

# Free a Bash call by the sandbox it runs in, and gate only the unsandboxed commands

The tier gate freed a Bash call only when its text proved where its writes land and that it opens no credential, so `node` on a script, inline code and writes to variable paths asked. Every Bash call now runs in Claude Code's sandbox, in Interactive sessions and runner steps alike, with unsandboxed commands disabled. The kernel holds a sandboxed call's writes to the workspaces and temp, its reads off the credential files, and its network to the npm registry, so git or discarding temp undoes it, and it is free. Commands that need a credential, GitHub, Google or the primary's git folder run unsandboxed by name, from `excludedCommands`, under today's tier rows. With the sandbox off, every other call asks.

Source: ByronBroughten/byro-repo#519

## Considered Options

- **A container per agent, as Sandcastle runs one**: rejected, since it boxes only the agents it launches, so Interactive sessions get nothing, and it duplicates the runner's worktrees and merge-back. Its own clone and scoped token are containment's gains, left to ByronBroughten/byro-repo#520.
- **Freeing only `node`, inline code and variable-path writes when sandboxed**: rejected, since the box bounds every other sandboxed call the same way, and freeing them all retires the parsing that served only them.
- **GitHub on the sandbox's network allowlist**: rejected, since the keychain gave a sandboxed `git` the GitHub token ([the sandbox observations](../claude-code-behaviour.md#the-bash-sandbox)), which would let any sandboxed script push.
- **Today's rules when the sandbox is off**: rejected, since that keeps all the parsing alive for a misconfigured state that a run of asks makes plain.

## Consequences

- ADR 0024 supersedes this ADR's rejection of GitHub on the allowlist and its denial of the git folders: GitHub and the git folders are now in the box, and the commands that needed them run sandboxed.
- Amended by ByronBroughten/byro-repo#547: with GitHub in the box, Phase 2 of ByronBroughten/byro-repo#519 frees every sandboxed call except one holding `gh` or `git push`, which keeps its tier row, since nothing undoes a GitHub write. A script's own GitHub calls stay ADR 0024's accepted risk, left to the scoped token of ByronBroughten/byro-repo#520.
- This is not the containment ADR 0007 defers: unsandboxed commands and Claude's own tools still act with full access, so ADR 0007 stands.
- `excludedCommands` is the one list of unsandboxed commands, and the gate reads it from settings.
- A domain added to the allowlist is weighed as a place a script could send what it reads, since the read denies name credential files one at a time.
