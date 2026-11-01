# Claude Code behaviour

An [observation index](./agents/prose-files.md#terms) of what Claude Code itself does that the repo's gates rest on, grouped by behaviour, following the [observation-index rules](./prose-style.md#observation-indexes). Each line gives its tag, what was seen, the Claude Code version and date it was probed, and its evidence: the issue comment holding its probe table and denial texts, or the commit that recorded it.

## What a hook's allow clears

- Observed: In a headless `-p` step under `acceptEdits`, a PermissionRequest allow clears an Edit or Write to `.claude/skills/`, `.claude/hooks/`, `.claude/settings.json`, `.vscode/settings.json`, an Edit to `.mcp.json`, and a Bash write into `.claude/`; 2.1.312, 2026-10-28; [#446 on #445](https://github.com/byronbroughten/byro-repo/issues/445#issuecomment-6482122578).
- Observed: A PreToolUse allow does not clear a Bash write into a protected path: Claude Code's own path check still denies it; 2.1.312, 2026-10-28; [#446 on #445](https://github.com/byronbroughten/byro-repo/issues/445#issuecomment-6482122578).
- Observed: Either hook's allow clears `cd <dir> && git`, and a PermissionRequest allow clears a Read outside the cwd; 2.1.312, 2026-10-28; [#446 on #445](https://github.com/byronbroughten/byro-repo/issues/445#issuecomment-6482122578).
- Observed: A settings deny rule acts before any hook: neither PreToolUse nor PermissionRequest fires; 2.1.312, 2026-10-28; [#446 on #445](https://github.com/byronbroughten/byro-repo/issues/445#issuecomment-6482122578).
- Observed: `.githooks/` isn't protected: an Edit there passes with no prompt; 2.1.312, 2026-10-28; [#446 on #445](https://github.com/byronbroughten/byro-repo/issues/445#issuecomment-6482122578).
- Observed: Hook code in a root `hooks/` folder isn't protected: an Edit there passes with no prompt; 2.1.312, 2026-10-28; [#456 on #445](https://github.com/byronbroughten/byro-repo/issues/445#issuecomment-6485345747).

## What `--setting-sources` drops

- Observed: `--setting-sources user,local` drops the folder's project hooks, `.claude/skills/` and `.claude/agents/`, and `--add-dir <cwd>` doesn't bring them back; hooks passed in `--settings` still fire; 2.1.312, 2026-10-28; [#446 on #445](https://github.com/byronbroughten/byro-repo/issues/445#issuecomment-6482122578).
- Observed: With the default sources and a `--settings` JSON, the folder's skills, agents and `CLAUDE.md` all load; 2.1.312, 2026-10-28; [#456 on #445](https://github.com/byronbroughten/byro-repo/issues/445#issuecomment-6485345747).

## Hook dedupe and the gate root

- Observed: One hook command string in both the project's `.claude/settings.json` and `--settings` runs once: Claude Code dedupes on the unexpanded string; 2.1.312, 2026-10-28; [#456 on #445](https://github.com/byronbroughten/byro-repo/issues/445#issuecomment-6485345747).
- Observed: `node "${BYRO_GATE_ROOT:-$CLAUDE_PROJECT_DIR}/.claude/hooks/<hook>.ts"` expands from the spawn's environment, so with `BYRO_GATE_ROOT` set the deduped command runs the gate root's file, and with it unset the project's; 2.1.312, 2026-10-28; [#456 on #445](https://github.com/byronbroughten/byro-repo/issues/445#issuecomment-6485345747).
- Observed: A project copy changed to a different command runs beside the `--settings` one, and the `--settings` copy's deny wins over the project copy's allow; 2.1.312, 2026-10-28; [#456 on #445](https://github.com/byronbroughten/byro-repo/issues/445#issuecomment-6485345747).

## Symlinks and protection

- Observed: Protection follows the path the tool names: an Edit to a skill's real file outside `.claude/` passes with no prompt, while an Edit through the `.claude/skills/<name>` symlink to it is denied, the denial naming the target; 2.1.312, 2026-10-28; [#456 on #445](https://github.com/byronbroughten/byro-repo/issues/445#issuecomment-6485345747).
- Observed: A symlinked skill's announced base directory is the symlink's path, `.claude/skills/<name>`, not its real folder, and the model resolved a relative link from there: a link written from the real folder reaches the same file only if it climbs to a folder both paths share; 2.1.312 and earlier, 2026-10-28, from every load of `/runner`, `/judge-findings` and `/mine-outcomes` in this repo's session transcripts; [recorded in 27957349](https://github.com/byronbroughten/byro-repo/commit/27957349382f7ef2e5734ca1355ea5bf2b9d616d).
