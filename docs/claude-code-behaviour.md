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

## The Bash sandbox

- Observed: In a headless `-p` run whose `--settings` enabled the sandbox with `allowUnsandboxedCommands: false`, a `touch` and a `node -e` write to `~` failed with "Operation not permitted", leaving no file, and a `touch` in the cwd succeeded; 2.1.316, 2026-10-31; [spike on #519](https://github.com/byronbroughten/byro-repo/issues/519#issuecomment-6562317317).
- Observed: In the same run, with `denyRead` on `~/.clasprc.json`, `head -c 1` of it failed with "Operation not permitted"; 2.1.316, 2026-10-31; [spike on #519](https://github.com/byronbroughten/byro-repo/issues/519#issuecomment-6562317317).
- Observed: In the same run, with `github.com` and `api.github.com` in `allowedDomains`, `git ls-remote` of a private repo through the `osxkeychain` credential helper printed a commit sha, and `gh api user` failed with `x509: OSStatus -26276`; 2.1.316, 2026-10-31; [spike on #519](https://github.com/byronbroughten/byro-repo/issues/519#issuecomment-6562317317).
- Observed: In the same run, a PreToolUse hook on Bash logged one entry for each of the 6 sandboxed calls, and no call prompted; 2.1.316, 2026-10-31; [spike on #519](https://github.com/byronbroughten/byro-repo/issues/519#issuecomment-6562317317).
- Documented: Command hooks and local MCP servers run outside the sandbox, with the user's full access; 2026-10-31; [Sandboxing](https://code.claude.com/docs/en/sandboxing).
- Documented: With `sandbox.allowUnsandboxedCommands: false`, Claude Code ignores a Bash call's `dangerouslyDisableSandbox`; 2026-10-31; [Sandboxing](https://code.claude.com/docs/en/sandboxing).
- Observed: In a headless `-p` run whose `--settings` excluded `git ls-remote *` with `allowUnsandboxedCommands: false`, `git ls-remote origin HEAD` alone, or `&&`-joined with itself, printed the sha; the same command after `cd . &&` or `true;`, before `| head -1` or `&& curl`, inside `echo $(…)` or with a `<<'EOF'` heredoc ran in the box in whole, its `ls-remote` denied `github.com`; 2.1.316, 2026-11-01; [inventory on #522](https://github.com/byronbroughten/byro-repo/issues/522#issuecomment-6563690204).
- Observed: With `denyWrite` on the primary root and `allowWrite` on folders under it, a `touch` in each allowed folder and in the cwd, a workspace under that root, failed with "Operation not permitted"; 2.1.316, 2026-11-01; [inventory on #522](https://github.com/byronbroughten/byro-repo/issues/522#issuecomment-6563690204).
- Observed: Inside the sandbox, `ps -o lstart= -p $PPID` failed with "operation not permitted: ps", and `printenv TMPDIR` printed `/tmp/claude-501`; 2.1.316, 2026-11-01; [inventory on #522](https://github.com/byronbroughten/byro-repo/issues/522#issuecomment-6563690204).
- Observed: An `excludedCommands` entry `npm run issue:*` left `npm run issue:read -- …` in the box, its `gh` failing with `x509: OSStatus -26276`, and `npm run issue*` took it out; 2.1.316, 2026-11-01; [inventory part 2 on #522](https://github.com/byronbroughten/byro-repo/issues/522#issuecomment-6563936270).
- Observed: With a `Read` deny in `permissions.deny` on a file and no `allowRead`, `tsc` in the box reported TS6053 for the file; with a `sandbox.filesystem.allowRead` on the same path added, `tsc` in the box passed; 2.1.316, 2026-11-01; [inventory part 2 on #522](https://github.com/byronbroughten/byro-repo/issues/522#issuecomment-6563936270).
- Observed: Edits to the `sandbox` block's `allowRead` and `excludedCommands` in `.claude/settings.json` applied to the session's next Bash call, with no restart; 2.1.316, 2026-11-01; [inventory part 2 on #522](https://github.com/byronbroughten/byro-repo/issues/522#issuecomment-6563936270).
- Documented: PostToolUse runs after a tool call succeeds and PostToolUseFailure after one that started executing fails; a Bash command that exits non-zero reaches PostToolUseFailure, whose `error` field opens with `Exit code N` and holds the command's output, and which takes `additionalContext`; 2026-11-01; [Hooks reference](https://code.claude.com/docs/en/hooks).
- Documented: With `sandbox.enabled` on and the sandbox unable to start, Claude Code runs commands unsandboxed unless `sandbox.failIfUnavailable` is set; with it set, Claude Code refuses to start; 2026-11-01; [settings reference](https://code.claude.com/docs/en/settings-reference).
