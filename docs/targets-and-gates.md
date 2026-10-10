# Targets and gates

Map fragment routed from `AGENTS.md`. Read the heading the task needs.

**Every live command names a target, `dev` or `app`, and the target decides what needs a yes first.** How the hosts, the bin, the chore dry run and the probe work is the framework's [`how-it-runs.md`](../packages/framework/docs/how-it-runs.md). Claude Code's hooks are [`docs/claude-code-guardrails.md`](./claude-code-guardrails.md).

## Targets: dev and app

**Every live command names its target through a root alias: `dev:*` for the `Sheets Framework Dev` spreadsheet, `app:*` for the real-estate one.** Each alias runs its package's own script with `-w <pkg> --` (`sheets-real-estate` for `app:*`, `@byronbroughten/sheets-framework` for `dev:*`), so npm runs the bin from that package and it finds that package's `sheets.config.json`. A bare `npx sheets-framework …` matches no allow rule, so it always asks.

The threat model is accidents, with tampering made visible. Both clasp credentials cover the whole Google account, so OAuth can't isolate the two spreadsheets; the permission rules and hooks do.

| Command | dev | app |
| --- | --- | --- |
| `probe`, `chore <name>` (dry run) | allow | allow |
| `configs:diff` (no credential, no live sheet) | allow | allow |
| `chore <name> -- --send` | allow | ask, and the yes must name the chore |
| `gen:configs` | allow | allow, under the four conditions below |
| `push` / `run <fn>` / `build` | allow | ask |
| `clasp deploy`, bare `clasp *` | ask | ask |
| gworkspace Sheets writes (`guardedSheetsWrites`) | allow | ask, with the exact sheet, range and values |
| gworkspace Docs writes, file creation, share tools | ask | ask |
| gworkspace reads | allow | allow |

**`npm publish` is ask-first, apart from the two targets.** It publishes `@byronbroughten/config` or `@byronbroughten/utils` to the public npm registry, where a version can't be replaced and a removal is time-limited, so a yes covers one publish of one version, and the agent shows the `npm pack --dry-run` file list before asking. For utils, `npm run smoke` in `packages/utils` passes first. `npm adduser` is the developer's own step.

- **Bare `npx sheets-framework …`, `node packages/framework/scripts/sheets-framework.js …`, a package-level `npm run chore …` and `npm run … -w …` match no rule, so they ask.** The only `--send` ask rule is `npm run app:chore * --send*`.
- **A dev write's standing yes holds only while the pinning files are clean**, and a gworkspace Sheets write gets it only on the dev ID. The hook: `pinnedTargetGuard.ts` in [`docs/claude-code-guardrails.md`](./claude-code-guardrails.md).
- **`dev:build`, `dev:push` and `dev:run` run the framework package's `build`, `push` and `run` scripts** against the dev project named in its `.clasp.json` ([the dev project](../packages/framework/docs/how-it-runs.md#the-dev-project)).
- **Both targets' Node-host credential comes from GCP project `real-estate-manager-sheets`**, whose consent screen is published to production so its refresh tokens don't expire ([why](../packages/framework/docs/how-it-runs.md#when-the-node-host-fails-to-authenticate)).
- **The dev spreadsheet is not a rehearsal copy of the app one.** Sheet configs key every sheet by its GID, and the dev sheet carries its own fixture sheets, not a copy of the business ones.

## Before touching the live spreadsheet or deployment

**Never run these against the app target without asking the user first** — they change the live Apps Script deployment or write to the user's real Google Sheet. A yes for the dev spreadsheet never covers the app one. Reading either sheet needs no yes:

- `npm run app:build` (runs `clasp push`)
- `clasp push`, `clasp run <anything>`, `clasp deploy` (deploy asks on both targets)
- `npm run app:chore <name> -- --send`, which applies a chore to the live spreadsheet. The yes has to name that chore; a general go-ahead is not one.

`npm run tsc` (type-checking only) is always safe to run freely, and so is `npm run app:chore <name>` without `--send`, which cannot write ([the dry run](../packages/framework/docs/how-it-runs.md#the-chore-and-its-dry-run)).

`npm run app:gen:configs` **writes** to the live spreadsheet ([what it writes](../packages/framework/docs/how-it-runs.md#what-gen-configs-writes)). It has **standing permission** under four conditions, all of which must hold. `dev:gen:configs` needs only the last two, since the dev spreadsheet holds no business data:

- no uncommitted changes in the framework's `src/01_SpreadsheetSchema/` or the app's `src/generated/`;
- no uncommitted changes in the framework's `src/05_Operators/`, because the command now executes local, possibly unreviewed operator code against the live config sheets;
- the agent reports what changed, the floor report, the declared-cell report, and the untyped-column count it returned;
- it is never a blind fix for a type error whose cause has not been identified. An identified identity or incidental retarget goes through [retarget-after-gen-configs](../.claude/skills/retarget-after-gen-configs/SKILL.md); an unidentified one still means no patch.

**A guard ships in the same commit as the write it guards, or earlier** ([`packages/framework/src/AGENTS.md`](../packages/framework/src/AGENTS.md)). A standing-permission `gen:configs` run can land between any two commits, so a write merged ahead of its refusal or fail-closed check writes unguarded.

The agent verifies a chore's preview before handing it over (the rule: [`src/chores/AGENTS.md`](../packages/framework/src/chores/AGENTS.md)), comparing the rendered requests against what the chore was meant to do and calling out anything wrong or larger than intended. That is a workflow obligation, not a code feature.

## The `gworkspace` MCP tools

**The agent account is `byronbroughtenai@gmail.com`, the one Google identity behind agent access to Docs, Drive and Sheets.** To grant access to a file or folder, share it with the agent account, as Editor, from the main account. `clasp` and the Node-host credential stay on the main account.

The `gworkspace` MCP server signs in as the agent account; what it is and what it can see: [the framework's notes](../packages/framework/docs/how-it-runs.md#the-gworkspace-mcp-tools). It is registered in `~/.claude.json` under this project, never in a repo file. Setting it up, re-authorizing after a dead token, or adding a service is a re-run of `scripts/setup-agent-account-mcp.sh`; `scripts/retire-gsheets-service-account.sh` retired the old service account once that passed.

- **Sheets, Docs and Drive reads are always fine to use freely**; the read tools are on the allow-list.
- **`app:probe`/`dev:probe` are read-only and on the allow-list, like a chore dry run.** Ask before running any other script that opens the `clasp` credential. The chore runner and `gen:configs` are exempt, because they open it as a routine step and the permissions above cover them.
- **Sheets writes on the dev spreadsheet have a standing yes**, granted by `pinnedTargetGuard.ts` while the pinning files are clean. The guarded tools are `guardedSheetsWrites` in `.claude/hooks/lib/pinnedTargets.ts`.
- **Any other Sheets write requires stating a specific plan and getting explicit permission before calling it.** "Can I edit the sheet?" is not enough; state the exact sheet, range, and values and wait for a yes.
- **Every Docs write asks, and the ask names the doc and the change.** The one exception is a piece spec's Deliverable: a typed `/implement-piece <n>` grants a standing yes to the Doc ID in issue #n's Deliverable section, for as long as that spec (a ticket's parent) is open ([`docGrantGuard.ts`](./claude-code-guardrails.md)). No other doc has one.
- **Creating a spreadsheet, doc or other Drive file always asks**, naming what is being created.
- **A share tool (`manage_drive_access`, `set_drive_file_permissions`, and `update_drive_file`, which can change sharing settings) needs its own, separate confirmation**: it grants a third party access, not just data. State exactly who it's being shared with and at what permission level, and get explicit sign-off on that, distinct from any data-write approval.
- **The server's version is pinned; upgrades are manual.** Read the release notes, bump the pin in the setup wizard, check the tool names in `.claude/settings.json` and `guardedSheetsWrites` against the new version, re-run the wizard's registration stage, and re-test on the dev spreadsheet.
