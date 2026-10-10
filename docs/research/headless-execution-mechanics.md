# Headless execution mechanics (#200, child of map #197)

Researched 2026-10-10. Local versions: Claude Code `2.1.296`, `cursor-agent` `2026.10.01-14929f9` (logged in as byron.broughten@gmail.com).

## Summary

- **`claude -p` covers what the runner needs.** Per-run `--model` and `--effort`, `--output-format json|stream-json`, schema-validated output through `--json-schema` (the result goes in `structured_output`), `--permission-mode`, `--permission-prompts none`, `--max-turns`, `--max-budget-usd`, `--session-id <uuid>`, and `--resume <id>`. All of these are in the installed `--help` and the CLI reference.
- **Without `--bare`, a `-p` run loads everything an interactive session loads.** That covers CLAUDE.md (and so AGENTS.md), `.claude/settings.json` permissions and hooks, skills and agents. A prompt of `/implement …` expands a user-invoked skill even when it has `disable-model-invocation: true`. `--bare` skips all of these and also ignores the subscription login, so it needs `ANTHROPIC_API_KEY`.
- **In `-p`, the repo's `ask` rules become denials** because there is nobody to ask. Edits need `acceptEdits`, `auto` or allow rules: a fresh `-p` run starts in `default` (Manual) mode.
- **The JSON result does not report peak context.** `usage` is cumulative and covers the main loop only. `modelUsage` adds `contextWindow` but is also cumulative. Peak context has to come from per-message usage, either from `stream-json` assistant messages or from the transcript `~/.claude/projects/<cwd-dashed>/<session_id>.jsonl`, as `max(input + cache_read + cache_creation)`. The repo's `contextNudge.ts` already uses that formula. The TS SDK also has `getContextUsage()`.
- **The TS Agent SDK (`@anthropic-ai/claude-agent-sdk`) runs the same bundled Claude Code binary.** On top of `-p` it adds typed messages, in-process hook callbacks, `canUseTool`, programmatic subagents, `outputFormat` and `settingSources`. It defaults to loading user, project and local settings. The docs tell third-party developers to use an API key. The support article dated 2026-10-07 says Agent SDK and `claude -p` usage can still draw on subscription limits.
- **`cursor-agent -p` has `--model`, `--output-format text|json|stream-json`, `--force` and `--mode plan|ask`.** It reads `.cursor/rules`, AGENTS.md and CLAUDE.md. The json result has `result`, `session_id` and `duration_ms`, but the docs list no usage field. Cheap models on this account include `composer-2.5`, `claude-haiku-5-5-*`, `gpt-5.4-nano-*`/`-mini-*` and `gemini-3.x-flash-*`.
- **Billing.** Pro/Max usage limits (5-hour plus weekly) are shared across Claude and Claude Code. `claude -p` signed in with the plan draws on those limits. Max's monthly API credits cover the Agent SDK only through an API key from the linked Console org, and they don't cover Claude Code. The Consumer Terms bar scripted access "except … where we otherwise explicitly permit it". The Claude Code legal page says advertised limits "assume ordinary, individual usage of Claude Code and the Agent SDK". No document states a hard cap on scripted personal use.

---

## 1. `claude -p` flags a runner relies on

All of these appear in local `claude --help` (2.1.296) and in [CLI reference](https://code.claude.com/docs/en/cli-reference) unless noted.

| Need | Flag | Notes |
| --- | --- | --- |
| Model per run | `--model <alias\|full id>` | Aliases `sonnet`, `opus`, `haiku`, `fable`. Overrides the `model` setting and `ANTHROPIC_MODEL`. `--fallback-model a,b` takes a chain. |
| Effort per run | `--effort low\|medium\|high\|xhigh\|max` (also `ultracode` per docs) | "Overrides the `modelSettings` and `effortLevel` settings for this session and does not persist." Available levels depend on the model ([CLI ref](https://code.claude.com/docs/en/cli-reference)). In `-p`, `/model sonnet` and `/effort …` with an argument also work, from v2.1.205 ([headless](https://code.claude.com/docs/en/headless)). |
| Machine-readable output | `--output-format json` (one result object) or `stream-json` (NDJSON; the docs pair it with `--verbose`) | json carries `result`, `session_id`, usage, `total_cost_usd` and per-model breakdown ([headless](https://code.claude.com/docs/en/headless)). The last stream line is the `result` message. |
| Schema-constrained output | `--json-schema '<schema>'` together with `--output-format json` | "Get validated JSON output matching a JSON Schema after the agent completes its workflow (print mode only)". The output lands in `structured_output`. An invalid schema exits with `Error: --json-schema is not a valid JSON Schema` (v2.1.205+). `format` is an annotation only ([headless](https://code.claude.com/docs/en/headless)). The SDK validates against draft-07 and re-prompts on a mismatch. When retries run out, subtype is `error_max_structured_output_retries`. `success` with no `structured_output` is possible and should count as a failure ([structured outputs](https://code.claude.com/docs/en/agent-sdk/structured-outputs)). |
| Unattended permissions | `--permission-mode default\|acceptEdits\|plan\|auto\|dontAsk\|bypassPermissions` (`manual` is an alias of `default`) and `--permission-prompts none` (v2.1.259+) | `-p` starts in `default` "in sessions that fetch feature flags" ([permission modes](https://code.claude.com/docs/en/permission-modes)). With no permission host, "these requests are denied either way". `--permission-prompts none` additionally tells Claude not to retry and removes `AskUserQuestion` ([headless](https://code.claude.com/docs/en/headless)). `dontAsk` "denies every call that would otherwise prompt", but allow rules still run. `acceptEdits` writes files, but other shell commands need an allow rule. `auto` uses a classifier, and anything it would escalate is denied in `-p`. `--dangerously-skip-permissions` equals `bypassPermissions`. Denials are listed in the result's `permission_denials`. |
| Bounding a run | `--max-turns N`, `--max-budget-usd X` | Both are print mode only. The budget is a client-side estimate that "can pass the cap" ([CLI ref](https://code.claude.com/docs/en/cli-reference)). |
| Session ids | `--session-id <uuid>` (choose it up front); `session_id` in json output | Choosing the id lets the script know the transcript path before the run ends. |
| Continue a step | `--resume <id\|name\|transcript path>`, `--continue`, `--fork-session` | `-p --resume` finds the id in any project on the machine (v2.1.223+). A resumed `-p` run starts in the permission mode a new `-p` run would, and does not restore the old mode. `--mcp-config`, `--settings`, `--add-dir` and `--plugin-dir` must be passed again ([sessions](https://code.claude.com/docs/en/sessions)). A resumed result's cost totals include earlier runs from v2.1.277 on ([cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking)). |
| No transcript | `--no-session-persistence` | Leave this off if peak context is read from the transcript. |
| Exit status | 0 on success, non-zero on failure. "When a failure happens inside the run, such as missing authentication, Claude Code prints the failure as the result on stdout." SIGTERM gives 143 and leaves the turn unfinished. SIGINT ends the turn cleanly ([headless](https://code.claude.com/docs/en/headless)). |
| Background work at exit | A `-p` run waits for background subagents and commands. Idle waiting is capped at 10 minutes by default (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`) ([headless](https://code.claude.com/docs/en/headless)). |

Other useful flags: `--append-system-prompt[-file]`, `--agents <json|file>`, `--tools`, `--allowedTools`/`--disallowedTools`, `--setting-sources user,project,local`, `--settings <file|json>`, `--name`, `--worktree`, `--include-hook-events` (stream-json), `--forward-subagent-text` (stream-json). Note that `--bg` cannot be combined with `-p` ([headless](https://code.claude.com/docs/en/headless)).

## 2. What loads in headless mode

- **Without `--bare`, a run loads what interactive loads.** "Without it, `claude -p` loads the same context an interactive session would, including anything configured in the working directory or `~/.claude`." Also: "a `-p` session runs the hooks in a project's `.claude/settings.json` and connects the servers in its `.mcp.json`, even in a folder you've never trusted. A `-p` session shows no workspace trust dialog" ([headless](https://code.claude.com/docs/en/headless)). The installed `--help` adds: "Settings files that fail validation are silently ignored in this mode (no error dialog is shown)". A typo in `.claude/settings.json` would therefore silently drop every hook and permission rule. A runner should check for this, for example by running `claude doctor` or by inspecting the `system/init` event.
- **Skills, including `disable-model-invocation: true`, can be invoked from the prompt.** "User-invoked skills and custom commands work. Include `/skill-name` in the prompt string and Claude Code expands it before running" ([headless](https://code.claude.com/docs/en/headless)). `disable-model-invocation: true` means "You can invoke: Yes / Claude can invoke: Not on its own" ([skills](https://code.claude.com/docs/en/skills)). So `claude -p "/implement #123"` should work. Project skills load from `.claude/skills/` "in the directory where you start it and in every parent directory up to the repository root" ([skills](https://code.claude.com/docs/en/skills)).
- **Settings and hooks load only from the launch directory.** Project `settings.json` and hooks "load only from `<cwd>/.claude/` with no parent-directory fallback" ([SDK features](https://code.claude.com/docs/en/agent-sdk/claude-code-features)). This matches the repo rule in `docs/claude-code-guardrails.md:7`: launch from the repo root.
- **CLAUDE.md** loads at session start from cwd and its parent directories (SDK features page, same mechanism). The repo's `CLAUDE.md` imports `@AGENTS.md`.
- **`--bare`** skips "hooks, skills, custom commands, subagents, installed plugins, MCP servers, auto memory, and CLAUDE.md", and also drops system reminders and background tasks. "Bare mode doesn't use your subscription login": it reads only `ANTHROPIC_API_KEY` or an `apiKeyHelper`. `--bare` "will become the default for `-p` in a future release" ([headless](https://code.claude.com/docs/en/headless)). **This is a forward risk.** A runner that depends on project hooks and skills should not rely on the current default. It can pin the behaviour with explicit `--setting-sources user,project,local` (whether that overrides a future bare default is unknown).
- **`--safe-mode`** and `--restricted` also strip customizations ([CLI ref](https://code.claude.com/docs/en/cli-reference)).

### Repo-specific consequences

The settings come from `.claude/settings.json` and the hooks from `docs/claude-code-guardrails.md`.

- **The `ask` list (settings.json:55-71) turns into denials** under `-p` with no host. This covers `app:chore * --send`, `app:build`, `clasp deploy` and gworkspace create/share calls. These are safe failures, but a step that needs one will stall until an operator acts.
- **`allow` rules (settings.json:3-54) still pre-approve** `npm run tsc`, `npm test`, `npx eslint *` and the `dev:*` commands. `npm run lint` is **not** in the allow list, and neither is `git` (commit, branch). In `default` or `dontAsk`, such a call is denied unless it falls in the read-only command set. A runner has to add `--allowedTools` entries, pick `auto`, or do git itself.
- **PreToolUse/PostToolUse hooks fire in `-p`** (headless page). `styleGate.ts` will deny code edits until `config/docs/code-style.md` is read in full in that session, and the headless agent will see that deny message. `contextNudge.ts` reminds at 150K tokens.
- **`UserPromptSubmit` hooks** (`docGrantGuard.ts`, `readCountNudge.ts`) presumably fire on the `-p` prompt. No document states this explicitly for `-p`; it is unverified.
- **Permission defaults from project settings are partly ignored.** A `defaultMode` of `"auto"` or `"bypassPermissions"` in `.claude/settings.json` or `.claude/settings.local.json` "doesn't take effect" ([permission modes](https://code.claude.com/docs/en/permission-modes)). Pass the mode on the command line instead.

## 3. Reading peak context and token usage

**The JSON result is cumulative, not peak.** `SDKResultMessage` (the same shape `--output-format json` emits, per the SDK docs) has these fields ([TS reference](https://code.claude.com/docs/en/agent-sdk/typescript)):

- `subtype`: `success` or one of `error_max_turns`, `error_during_execution`, `error_max_budget_usd`, `error_max_structured_output_retries`.
- `session_id`, `num_turns`, `duration_ms`, `duration_api_ms`, `is_error`, `result`, `stop_reason`, `total_cost_usd`.
- `usage: NonNullableUsage` and `modelUsage: {[model]: ModelUsage}`.
- `permission_denials`, `structured_output?`, `terminal_reason?`, `errors[]` (on error results).

`ModelUsage` = `{inputTokens, outputTokens, thinkingTokens?, cacheReadInputTokens, cacheCreationInputTokens, webSearchRequests, costUSD, contextWindow, maxOutputTokens, canonicalModel?, provider?, costBasis?}` ([TS reference](https://code.claude.com/docs/en/agent-sdk/typescript)). `contextWindow` gives the window size, not usage.

Scope rules ([cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking)):

- `usage` "Counts only the top-level agent loop", excluding subagents. `total_cost_usd` and `modelUsage` include subagents.
- Per-step `output_tokens` on assistant messages "is a placeholder". Read output from the result.
- Assistant messages that share a `message.id` (parallel tool calls) carry identical usage, so deduplicate by id.
- `total_cost_usd` and `costUSD` are "client-side estimates, not authoritative billing data". On a subscription they are notional.

**Peak context: options.**

1. **stream-json.** Each `assistant` event carries `message.usage`. Peak = max over main-loop messages (`parent_tool_use_id == null`) of `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. This is the formula the statusline uses for `used_percentage` ("calculated from input tokens only") ([statusline](https://code.claude.com/docs/en/statusline)). It is also the formula in `.claude/hooks/lib/contextNudge.ts:44`.
2. **Transcript JSONL** at `~/.claude/projects/<project>/<session-id>.jsonl`, "where `<project>` is your working directory path with non-alphanumeric characters replaced by `-`". The docs warn "The entry format is internal to Claude Code and changes between versions" ([sessions](https://code.claude.com/docs/en/sessions)). Local observation, not documented: assistant lines have `type:"assistant"`, `isSidechain` and `message.usage` with the three input fields. A sample session computed a 420,058-token peak this way. Subagent transcripts live beside it in `<session-id>/subagents/agent-*.jsonl` with a `.meta.json`. With `--session-id` chosen in advance, the path is known. Retention is 30 days by default (`cleanupPeriodDays`).
3. **Hooks.** Every hook receives `transcript_path` ([sessions](https://code.claude.com/docs/en/sessions) → hooks common input). A `Stop`/`SessionEnd` hook could compute and write the peak. The repo's `contextNudge.ts` already reads the transcript this way.
4. **SDK only:** `query.getContextUsage({detail: 'summary'|'full'})` returns a breakdown "by category, skill, and tool". `'full'` makes extra token-counting requests ([TS reference](https://code.claude.com/docs/en/agent-sdk/typescript)). This gives the current value, so the runner would sample it, not read a peak.
5. **Statusline data** (`context_window.used_percentage`, `total_input_tokens`, `context_window_size`, `rate_limits.five_hour/seven_day.used_percentage`) exists for the interactive UI ([statusline](https://code.claude.com/docs/en/statusline)). **Unknown:** whether a statusline command runs in `-p`. Probably not, since it is a TUI element. Don't depend on it.

**Weekly-limit headroom.** `rate_limits.seven_day.used_percentage` is exposed to statusline scripts, and only for Pro/Max subscribers ([statusline](https://code.claude.com/docs/en/statusline)). There is no documented equivalent field in the `-p` JSON result. Unknown whether stream-json emits a rate-limit event.

## 4. Claude Agent SDK (TypeScript) as the alternative

- **Package:** `@anthropic-ai/claude-agent-sdk`, Node 18+. It "bundle[s] a native Claude Code binary" through npm optional dependencies (`pathToClaudeCodeExecutable` overrides it) ([quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart)). It is the same engine as `claude -p`. The overview says: "A library that runs the Claude Code binary" ([overview](https://code.claude.com/docs/en/agent-sdk/overview)).
- **What it adds over shelling out** ([TS reference](https://code.claude.com/docs/en/agent-sdk/typescript), [SDK features](https://code.claude.com/docs/en/agent-sdk/claude-code-features)):
  - Typed message stream; options `model`, `effort`, `permissionMode`, `maxTurns`, `maxBudgetUsd`, `resume`, `sessionId`, `systemPrompt: {type:'preset', preset:'claude_code', append}`.
  - `outputFormat: {type:'json_schema', schema}`, which works with Zod via `z.toJSONSchema(s, {target:'draft-7'})`.
  - Programmatic `hooks` callbacks in-process. They fire in subagents too and carry `agent_id`/`agent_type`. They run alongside filesystem hooks.
  - `canUseTool` callback for permission decisions.
  - `agents` for subagents, plus `getContextUsage()`.
- **`settingSources`.** "When you omit `settingSources`, `query()` reads the same filesystem settings as the Claude Code CLI: user, project, and local settings, CLAUDE.md files, and `.claude/` skills, agents, and commands." `[]` disables them. Managed settings, `~/.claude.json` and auto memory load regardless ([SDK features](https://code.claude.com/docs/en/agent-sdk/claude-code-features)). Skills are invocable via `/name` in the prompt (same page, "User-invocable skills").
- **Auth and subscription.**
  - The docs steer to an API key: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK" ([overview](https://code.claude.com/docs/en/agent-sdk/overview)).
  - Mechanically, the SDK uses the CLI's credential precedence. The subscription OAuth from `/login`, or `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` ("requires a Pro, Max, Team, or Enterprise plan"), applies when no `ANTHROPIC_API_KEY` is set. In `-p`, an `ANTHROPIC_API_KEY` that is present "is always used" ([authentication](https://code.claude.com/docs/en/authentication)).
  - Policy-wise, the support article [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) (2026-10-07 update) says: "You can still use the Claude Agent SDK, claude -p, and third-party apps with your subscription limits."
  - The [legal page](https://code.claude.com/docs/en/legal-and-compliance) aims the restriction at developers routing **other users'** requests through plan credentials. A personal runner on one's own login is not that case. This is an interpretation; see section 6.

## 5. `cursor-agent` headless

From local `cursor-agent --help` (2026.10.01) and [Cursor CLI headless](https://cursor.com/docs/cli/headless):

- `-p/--print` "Has access to all tools, including write and shell". The Cursor docs say: "Without --force, changes are only proposed, not applied." `--force`/`--yolo` applies them, `--mode plan|ask` is read-only, and `--trust` skips the workspace trust prompt.
- `--model <id>` accepts bracketed overrides such as `'claude-opus-4-8[context=1m,effort=high]'`. `--list-models` and `cursor-agent models` list the models. `--resume [chatId]`, `--continue` and `create-chat` are available. `--worktree` gives isolation.
- `--output-format text|json|stream-json`. The json result has `type`, `subtype`, `is_error`, `duration_ms`, `result`, `session_id` and `request_id?`. **There is no documented usage or token field** ([output format](https://cursor.com/docs/cli/reference/output-format)). Stream events are `system/init`, `user`, `assistant`, `tool_call started/completed` and `result`.
- **Context:** "The CLI also reads `AGENTS.md` and `CLAUDE.md` at the project root", plus `.cursor/rules` and `mcp.json` ([using the CLI](https://cursor.com/docs/cli/using)). The repo's Cursor hook twins are in `docs/cursor-guardrails.md` (not read here).
- **Auth:** the login session (`cursor-agent status` shows it logged in) or `CURSOR_API_KEY`.
- **Cheap models offered on this account** (`cursor-agent models`, 260 lines): `auto`, `composer-2.5`, `composer-2.5-fast`, `claude-haiku-5-5-{low…max}` and `-thinking-*`, `gpt-5.4-nano-*`, `gpt-5.4-mini-*`, `gpt-5-mini`, `gemini-3.6/3.7/3.8-flash-*`, `gemini-3-flash`, `gemini-3.5-flash`, `cursor-grok-4.5/4.6-low`, `grok-4.7-low`, `kimi-k2.7-code`, `kimi-k3-low`.
- **Prices** ([models & pricing](https://cursor.com/docs/models-and-pricing), as read through a summarizer, so verify before relying): Composer 2.5 costs $0.5 in / $2.5 out per M tokens and sits in the "Cursor Models" pool (Grok 4.5-4.7, Composer 2.5). Claude Haiku 5.5 is listed at $0.1 in / $0.5 out per M (5x above 100k input tokens) in the "Other Models" pool.

## 6. Billing and terms

- **Claude Max.** "Both Pro and Max plans have a five-hour session limit and a weekly limit… shared across Claude and Claude Code" and "Max plans also have a separate weekly limit for Fable" ([support: Pro/Max with Claude Code](https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan)). `claude -p` and Agent SDK runs signed in with the plan draw on those subscription limits (support article 15036540, updates of 2026-06-15 and 2026-10-07).
- **Max monthly API credits** ($100 on Max 5x, $200 on Max 20x) cover "Claude API, Claude Managed Agents, the Claude Agent SDK, and playground" but not "Claude Code" ([API credits](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers)). Using them means an API key from the linked Console org. That key then pays per-token from the credit and does not touch the weekly limit. "Credits don't change your usage limits". **Unclear:** whether `claude -p` run with that key counts as "Claude Code" (excluded) or "Agent SDK" (covered). The support article lists `claude -p` among the products the credits cover, while the platform page excludes "Claude Code". Treat this as unresolved. The platform page also notes that an org with only these credits running "a Claude Code session" shows "Credit balance too low".
- **Terms.** The Consumer Terms (effective 2025-10-08, governing Free/Pro/Max per the [legal page](https://code.claude.com/docs/en/legal-and-compliance)) prohibit, "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it… to access the Services through automated or non-human means, whether through a bot, script, or otherwise" ([consumer terms](https://www.anthropic.com/legal/consumer-terms)). Anthropic's own docs and support article explicitly describe `claude -p`, `setup-token` for "CI pipelines and scripts", and Agent SDK use with subscription limits. That reads as the "explicitly permit" carve-out for one's own scripted use; this is an interpretation, not a quoted ruling. The legal page also says: "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK", and forbids routing requests "through Free, Pro, or Max plan credentials on behalf of their users".
- **Cursor.** Pro, Pro Plus and Ultra include two monthly pools, "Cursor Models" and "Other Models" (at API price). Auto bills "at the list price of the model each request is routed to" ([models & pricing](https://cursor.com/docs/models-and-pricing)). **Unknown:** whether the docs say CLI `-p` usage draws on the same pool as the editor. Presumably yes, since it is the same account login, but no source was found.

## Unknowns

1. Whether `--bare` becoming the `-p` default will need an opt-out flag, and whether `--setting-sources` alone restores hooks, skills and CLAUDE.md then.
2. Whether `UserPromptSubmit` hooks fire on the `-p` prompt. This is likely but not stated.
3. Whether the statusline command runs in `-p`, and whether any `-p` output exposes `rate_limits` (weekly headroom).
4. Whether `claude -p` run with a credit-linked API key is billed against Max API credits. Two Anthropic sources disagree.
5. Whether Cursor's CLI JSON exposes token usage anywhere (none documented), and whether CLI usage counts against the same pool.
6. Transcript JSONL format is officially internal and unstable. Parsing it (as `contextNudge.ts` does) can break on any release. stream-json `assistant.message.usage` is the documented alternative.
7. The full `NonNullableUsage` type was not read. The four token fields are confirmed via the cost-tracking page.

Non-primary sources consulted only for leads, not cited for facts: third-party pricing blogs returned by web search.
