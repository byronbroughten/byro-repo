# Claude Code behaviour

An [observation index](./agents/prose-files.md#terms) of what Claude Code itself does that the repo's gates rest on, grouped by behaviour, following the [observation-index rules](./prose-style.md#observation-indexes). Each line gives its tag, what was seen, the Claude Code version and date it was probed, and its evidence: the issue comment holding its probe table and denial texts, or the commit that recorded it.

## What a hook's allow clears

- Observed: In a headless `-p` step under `acceptEdits`, a PermissionRequest allow clears an Edit or Write to `.claude/skills/`, `.claude/hooks/`, `.claude/settings.json`, `.vscode/settings.json`, an Edit to `.mcp.json`, and a Bash write into `.claude/`; 2.1.312, 2026-10-28; [#446 on #445](https://github.com/byronbroughten/byro-repo/issues/445#issuecomment-6482122578).
- Observed: After a PreToolUse allow, a Bash write into a protected path was still denied; 2.1.312, 2026-10-28; [#446 on #445](https://github.com/byronbroughten/byro-repo/issues/445#issuecomment-6482122578).
- Observed: Either hook's allow clears `cd <dir> && git`, and a PermissionRequest allow clears a Read outside the cwd; 2.1.312, 2026-10-28; [#446 on #445](https://github.com/byronbroughten/byro-repo/issues/445#issuecomment-6482122578).
- Observed: On a call a settings deny rule matched, neither PreToolUse nor PermissionRequest fired; 2.1.312, 2026-10-28; [#446 on #445](https://github.com/byronbroughten/byro-repo/issues/445#issuecomment-6482122578).
- Observed: An Edit in `.githooks/` passed with no prompt; 2.1.312, 2026-10-28; [#446 on #445](https://github.com/byronbroughten/byro-repo/issues/445#issuecomment-6482122578).
- Observed: An Edit to hook code in a root `hooks/` folder passed with no prompt; 2.1.312, 2026-10-28; [#456 on #445](https://github.com/byronbroughten/byro-repo/issues/445#issuecomment-6485345747).

## What `--setting-sources` drops

- Observed: `--setting-sources user,local` drops the folder's project hooks, `.claude/skills/` and `.claude/agents/`, and `--add-dir <cwd>` doesn't bring them back; hooks passed in `--settings` still fire; 2.1.312, 2026-10-28; [#446 on #445](https://github.com/byronbroughten/byro-repo/issues/445#issuecomment-6482122578).
- Observed: With the default sources and a `--settings` JSON, the folder's skills, agents and `CLAUDE.md` all load; 2.1.312, 2026-10-28; [#456 on #445](https://github.com/byronbroughten/byro-repo/issues/445#issuecomment-6485345747).

## Hook dedupe and the gate root

- Observed: One hook command string in both the project's `.claude/settings.json` and `--settings` ran once; 2.1.312, 2026-10-28; [#456 on #445](https://github.com/byronbroughten/byro-repo/issues/445#issuecomment-6485345747).
- Observed: with `BYRO_GATE_ROOT` set in the spawn's environment, the deduped `node "${BYRO_GATE_ROOT:-$CLAUDE_PROJECT_DIR}/.claude/hooks/<hook>.ts"` ran the gate root's file, and with it unset the project's; 2.1.312, 2026-10-28; [#456 on #445](https://github.com/byronbroughten/byro-repo/issues/445#issuecomment-6485345747).
- Observed: A project copy changed to a different command ran beside the `--settings` one, and a call the `--settings` copy denied and the project copy allowed was denied; 2.1.312, 2026-10-28; [#456 on #445](https://github.com/byronbroughten/byro-repo/issues/445#issuecomment-6485345747).

## Symlinks and protection

- Observed: An Edit to a skill's real file outside `.claude/` passed with no prompt, while an Edit through the `.claude/skills/<name>` symlink to it was denied, the denial naming the target; 2.1.312, 2026-10-28; [#456 on #445](https://github.com/byronbroughten/byro-repo/issues/445#issuecomment-6485345747).
- Observed: A symlinked skill's announced base directory was the symlink's path, `.claude/skills/<name>`, not its real folder, and the model resolved relative links from there: a link written from the real folder reached the same file when it climbed to a folder both paths share, and missed it otherwise; 2.1.312 and earlier, 2026-10-28, from every load of `/runner`, `/judge-findings` and `/mine-outcomes` in this repo's session transcripts; [recorded in 27957349](https://github.com/byronbroughten/byro-repo/commit/27957349382f7ef2e5734ca1355ea5bf2b9d616d).
