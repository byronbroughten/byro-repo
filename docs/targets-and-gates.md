# Targets and gates

Map fragment routed from `AGENTS.md`. Read the heading the task needs.

**Every gated action sits in one of three tiers, by what it costs to undo, and its tier decides whether it needs a yes.** Why: "Gate by what it costs to undo" in [`docs/agent-behavior-design.md`](./agent-behavior-design.md). The hook that applies it is `tierGate.ts` ([`docs/claude-code-guardrails.md`](./claude-code-guardrails.md)). How the hosts, the bin, the chore dry run and the probe work is the framework's [`how-it-runs.md`](../packages/framework/docs/how-it-runs.md).

## The tiers

1. **Free: git can undo it.**
2. **Free: Google's version history is the undo point.**
3. **Ask: it can't be undone, or it reaches someone else.** An Interactive session asks the developer, naming the command, or the file, who and at what permission. A runner step's call is refused with that reason instead; record a `denied-tool` blocker and carry on.

Reads need no yes in any tier.

## Which tier an action is in

| Action | Tier |
| --- | --- |
| Editing repo files; `npm run tsc`, `npm test`, `npm run lint` | 1 |
| `git commit`, on any branch | 1; the branch guard still keeps a primary checkout on its branch, and the primary-edit guard keeps the commit out of one |
| `npm run issue:start`, `issue:list`, and `issue:remove` without `--force`, which refuses unlanded work | 1 |
| `npm run issue:remove … --force`, which discards a workspace's unlanded work | 3 |
| `npm run wrap-up -- <repo> <n>`, which pushes | a standing yes to push, behind its secret scan |
| `npm run wrap-up -- --session <slug>`, with or without `--keep`, which pushes | a standing yes to push, behind its secret scan |
| `probe`, `chore <name>` (dry run), `configs:diff` on either target | free: reads |
| `app:chore <name> -- --send` | 2, once this session has dry-run `<name>`; with no dry run it's refused, naming the dry-run command |
| `dev:chore <name> -- --send` | 2 |
| `app:gen:configs`, `dev:gen:configs` | 2, under [the conditions below](#gen-configs-standing-permission) |
| `app:build`, `app:deploy`, `dev:build`, `dev:push`, `dev:run`, `dev:deploy` | 2: Apps Script keeps each pushed version, and a deployment rolls back |
| gworkspace Sheets or Docs write, or a non-sharing `update_drive_file`, on a file one of the developer's two Google accounts owns | 2 |
| Creating, copying, importing or exporting a spreadsheet, Doc, Drive file or folder | 2 |
| gworkspace write on a file someone else owns, or whose owner can't be looked up | 3 |
| `manage_drive_access`, `set_drive_file_permissions`, an `update_drive_file` that changes sharing or moves a file into a folder | 3 |
| A raw `git push` | 3 |
| `npm publish` | 3, [below](#npm-publish) |
| A bare `clasp …` or `npx sheets-framework …` | 3: it names no target |
| Any other script that opens the `clasp` credential | 3 |
| Spending money; touching credentials | 3; no tool does either yet, so the first one lands gated |
| `npm run jev`, `npm run jev:style` | a standing yes: Deliverable text and repo docs, never secrets, `.env` files or credential files ([the Jev doc](./agents/jev.md#what-may-be-sent)) |

### npm publish

**`npm publish` is one yes per version.** It publishes `@byronbroughten/config` or `@byronbroughten/utils` to the public npm registry, where a version can't be replaced and a removal is time-limited, so the agent shows the `npm pack --dry-run` file list before asking. For utils, `npm run smoke` in `packages/utils` passes first. `npm adduser` is the developer's own step.

## Ticket targets

**A runner step writes outside the repo only to the targets its ticket names**, in a `## Targets` section just before `## Model fit`, one per line: `app spreadsheet`, `dev spreadsheet` or `doc <id>`.

- **A spreadsheet target gives the step that target's live `npm run` aliases and the gworkspace Sheets tools; a Doc target gives the Docs tools.** A ticket naming no targets launches with the runner config's fixed tools and no Google access at all.
- **A step's gworkspace write to a file its ticket doesn't name is refused, listing the ticket's targets.** The `app` and `dev` spreadsheet IDs come from each package's `sheets.config.json`.
- **The runner reads the section with the Model fit pair just before each launch**, so a target added mid-run takes effect, and its preflight refuses a run with a malformed line.

## Targets: dev and app

**Every live command names its target through a root alias: `dev:*` for the `Sheets Framework Dev` spreadsheet, `app:*` for the real-estate one.** Each alias runs its package's own script with `-w <pkg> --` (`sheets-real-estate` for `app:*`, `@byronbroughten/sheets-framework` for `dev:*`), so npm runs the bin from that package and it finds that package's `sheets.config.json`.

The threat model is accidents, with tampering made visible. Both clasp credentials cover the whole Google account, so OAuth can't isolate the two spreadsheets; the aliases and hooks do.

- **Bare `npx sheets-framework …`, `node packages/framework/scripts/sheets-framework.js …`, a package-level `npm run chore …` and `npm run … -w …` match no allow rule, so they ask.**
- **`dev:build`, `dev:push`, `dev:deploy` and `dev:run` run the framework package's `build`, `push`, `deploy` and `run` scripts** against the dev project named in its `.clasp.json` ([the dev project](../packages/framework/docs/how-it-runs.md#the-dev-project)); `app:build` and `app:deploy` run the app's.
- **Both targets' Node-host credential comes from GCP project `real-estate-manager-sheets`**, whose consent screen is published to production so its refresh tokens don't expire ([why](../packages/framework/docs/how-it-runs.md#when-the-node-host-fails-to-authenticate)).
- **The dev spreadsheet is not a rehearsal copy of the app one.** Sheet configs key every sheet by its GID, and the dev sheet carries its own fixture sheets, not a copy of the business ones.
- **The agent verifies a chore's preview before sending it** (the rule: [`src/chores/AGENTS.md`](../packages/framework/src/chores/AGENTS.md)), comparing the rendered requests against what the chore was meant to do and calling out anything wrong or larger than intended. That is a workflow obligation, not a code feature.

## gen-configs' standing permission

`npm run app:gen:configs` **writes** to the live spreadsheet ([what it writes](../packages/framework/docs/how-it-runs.md#what-gen-configs-writes)). It has **standing permission** under four conditions, all of which must hold. `dev:gen:configs` needs only the last two, since the dev spreadsheet holds no business data:

- no uncommitted changes in the framework's `src/01_SpreadsheetSchema/` or the app's `src/generated/`;
- no uncommitted changes in the framework's `src/05_Operators/`, because the command now executes local, possibly unreviewed operator code against the live config sheets;
- the agent reports what changed, the floor report, the declared-cell report, and the untyped-column count it returned;
- it is never a blind fix for a type error whose cause has not been identified. An identified identity or incidental retarget goes through [retarget-after-gen-configs](../.claude/skills/retarget-after-gen-configs/SKILL.md); an unidentified one still means no patch.

**A guard ships in the same commit as the write it guards, or earlier** ([`packages/framework/src/AGENTS.md`](../packages/framework/src/AGENTS.md)). A standing-permission `gen:configs` run can land between any two commits, so a write merged ahead of its refusal or fail-closed check writes unguarded.

## The `gworkspace` MCP tools

**The agent account is `byronbroughtenai@gmail.com`, the one Google identity behind agent access to Docs, Drive and Sheets.** To grant access to a file or folder, share it with the agent account, as Editor, from the main account. `clasp` and the Node-host credential stay on the main account.

The `gworkspace` MCP server signs in as the agent account; what it is and what it can see: [the framework's notes](../packages/framework/docs/how-it-runs.md#the-gworkspace-mcp-tools). It is registered in `~/.claude.json` under this project, never in a repo file. Setting it up, re-authorizing after a dead token, or adding a service is a re-run of `scripts/setup-agent-account-mcp.sh`; `scripts/retire-gsheets-service-account.sh` retired the old service account once that passed.

- **A write's owner is looked up in Drive and cached for the session**; the tool lists are in `.claude/hooks/lib/driveTiers.ts`.
- **A share's yes is its own**, separate from any data-write approval: state exactly who gets access and at what permission level, and get sign-off on that.
- **The server's version is pinned; upgrades are manual.** Read the release notes, bump the pin in the setup wizard, check the tool names in `.claude/settings.json` and `lib/driveTiers.ts` against the new version, re-run the wizard's registration stage, and re-test on the dev spreadsheet.
