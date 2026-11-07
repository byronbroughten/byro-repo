---
name: prompt-scan
description: Cut permission prompts by replaying recent sessions through the tier gate. Use when the developer asks for fewer permission prompts or an allowlist, in place of the built-in /fewer-permission-prompts.
---

Every Bash call meets `tierGate.ts` before Claude Code's allow rules, and a runner step gets only what the gate frees. So the Bash allowlist is [the tier table](../../../docs/targets-and-gates.md#which-tier-an-action-is-in) and its classifiers, and `.claude/settings.json` holds what the gate never sees.

## Steps

1. Run `npm run -s prompt:scan` (`-- --sessions <n> --top <n>`; 50 and 20 by default). It reads every stop in this repo's recent transcripts and prints six tables, each ranked by count: the calls the developer answered; the ones auto mode's classifier answered, which prompt outside auto mode; the gate's refusals; the sandbox's denials, by command and the path or host denied; Hand-backs, the commands an agent asked the developer to run; and Claude Code's removal check. Each Bash row says what this checkout's gate does with the command now.
2. Give every row one fix. A row of the first two tables gets it off its "The gate now" column:
   - **`free`**: the gate frees it since; no fix.
   - **`unclassified`**: a tier-row proposal, its tier set by what undoing the command costs. A read, or a write git or Google's version history undoes, gets a free row; a command that can't be undone or reaches someone else keeps Claude Code's prompt. An `npm run` script is freed in `freeScripts`, per subcommand when its subcommands cost different amounts to undo.
   - **`asks` or `refuses`**: the gate means it. Propose a gate fix only when the why shows it misreading a free call, such as a write into `/tmp` after a `cd` it can't follow. A row whose why names a free way through, a heredoc beside it included, is an agent habit: propose the doc or skill line that teaches the free way.
   - **`not a Bash call`**: a `permissions.allow` entry by exact tool name, for a read: an MCP `get`, `list`, `read` or `search` tool, or `WebSearch`. Writes stay with their gates.
   - **An Edit or Write of `.claude/settings.json` or another protected path**: Claude Code's own prompt, fixed like the removal check below.

   A row of the other four gets it by kind:
   - **A refusal**: the `asks` or `refuses` fix above, read off its Why column. A read-first refusal is the gate working; none.
   - **A sandbox denial or a Hand-back**: a reshape of the measure that stopped a routine command: a sandbox setting, an `excludedCommands` entry, or a repo script that does the step.
   - **The removal check**: none, counted. When it recurs, a doc line teaching the habit that avoids it.

   Done when every row has a fix or a stated reason for none.
3. Show the developer one table: the row, the proposed fix (a tier row and its tier, a settings entry, a doc line, or none) and the undo cost behind it. The developer picks; the pick is the request a tier-rule change needs.
4. Land the picks in a workspace. A gate fix is a tier row, its classifier under `.claude/hooks/lib/tiers/` and a case in `tiers.test.ts`, in one commit. A settings entry goes beside the others. Rerun the scan: each picked Bash row reads `free`. Then `npm run check` and wrap-up.
