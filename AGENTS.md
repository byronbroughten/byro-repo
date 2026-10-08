# Agent instructions for this repo

An npm-workspaces root: `packages/framework` (`@byronbroughten/sheets-framework`, a clone of its own repo), a TypeScript framework for typed apps on Google Sheets + Apps Script, and `packages/real-estate` (`sheets-real-estate`, a clone of its own repo), the real-estate endpoints built on it; a live spreadsheet is both database and UI. `packages/writing` (`writing`, a clone of its own private repo) is where prose piece specs are filed.

Open only the section or disclosed doc the task needs.

## Commands

- `npm run tsc`, `npm test` and `npm run lint`: always safe. Run all three before calling a change done, and treat a new type error as yours unless a clean checkout has it too.
- **Every live-spreadsheet command names its target: `dev:*` (the `Sheets Framework Dev` spreadsheet) or `app:*` (the real-estate one).** `dev:*` has a standing yes. `app:*` keeps the asks below. A yes for one spreadsheet never covers the other, and a bare `npx sheets-framework …` always asks. Full table: [`docs/targets-and-gates.md`](./docs/targets-and-gates.md#targets-dev-and-app).
- `npm run app:chore <name>`: a dry run, always safe. `npm run app:chore <name> -- --send` applies it and needs a yes **naming that chore**.
- `npm run app:probe`: read-only raw Sheets JSON. Stdout gets a summary and the full response goes to that package's `.probe/last.json`; read a line range of it, never print a full body into the chat. Ask before any other script that opens the `clasp` credential.
- `npm run app:gen:configs` writes to the live config sheets. **Before running it, check the four standing-permission conditions** in [`docs/targets-and-gates.md`](./docs/targets-and-gates.md#before-touching-the-live-spreadsheet-or-deployment).
- Ask first for `npm run app:build`, `clasp push` / `run` / `deploy`, any gworkspace Sheets write to the app spreadsheet (exact sheet, range and values) and any Docs write (the doc and the change). Creating a file asks; a share needs its own yes, naming who and at what permission. Reads need no yes.

## Every task

- **README.md is for humans.** Nothing in it is needed for a task here; open it only to keep it accurate ([`docs/agents/prose-files.md`](./docs/agents/prose-files.md)).
- **Which package: "would this make sense in a different Sheets-backed app?"** Yes: `packages/framework`. No: `packages/real-estate`. A lint, format or tsconfig setting any TypeScript project would want: `config`. A reader-facing Piece: `packages/writing`.
- **Public repos never depend on private ones; private may depend on public.**
- **Working in a folder with its own `AGENTS.md`**, read it first; each package's `src/` and several folders under it have one.
- **Commit or push only when asked. Implement a spec on its `issue-<n>-<slug>` branch**, even when a skill says to commit to the current branch. Branch rules: [`docs/agents/git-workflow.md`](./docs/agents/git-workflow.md).

## Read by task

| When | Open |
| --- | --- |
| Placing a file, import, or member; naming an accessor; profile vs Table; Raw, Identified or Named | [`packages/framework/src/AGENTS.md`](./packages/framework/src/AGENTS.md) + [vocabulary](./packages/framework/docs/vocabulary.md) |
| Writing or refactoring TypeScript, tests included | [`config/docs/code-style.md`](./config/docs/code-style.md), then for framework or app code [`packages/framework/docs/code-style.md`](./packages/framework/docs/code-style.md) |
| Operator-facing words: endpoint, selector, run state; units, the ledger | [`CONTEXT-MAP.md`](./CONTEXT-MAP.md), then that package's `CONTEXT.md` |
| Real-estate endpoints or app chores | [app `src/AGENTS.md`](./packages/real-estate/src/AGENTS.md) |
| Arguing that a gap is deliberate, or proposing a design principle | [design](./packages/framework/docs/design.md) |
| Architecture mechanics: dispatch, schema classes, class chains, queued writes, round trips, type-check cost | [architecture](./packages/framework/docs/architecture.md) index, then one file |
| Adding a deletion path | [blank-row](./packages/framework/docs/architecture/blank-row.md) |
| A one-off job against the live sheet | [chores](./packages/framework/docs/architecture/chores.md) |
| Hosts, bin, chore dry run, Sheets probe, gworkspace MCP | [how-it-runs](./packages/framework/docs/how-it-runs.md); gates: [targets-and-gates](./docs/targets-and-gates.md) |
| Claude Code hooks and the project agent | [`docs/claude-code-guardrails.md`](./docs/claude-code-guardrails.md) |
| Tests and fakes | [testing](./packages/framework/docs/testing.md) |
| Regen `tsc` fails, or hand-written sheet/column keys disagree with generated configs | [retarget-after-gen-configs](./.claude/skills/retarget-after-gen-configs/SKILL.md) |
| Branches, landing a spec, closing an issue, `backup/*` branches | [`docs/agents/git-workflow.md`](./docs/agents/git-workflow.md) |
| Design, grilling, specs, tickets, an offered ADR, a long session's handoff | [`docs/agents/planning.md`](./docs/agents/planning.md) |
| Writing reader-facing prose: a shared Google Doc, a blog post, in-app text, a piece spec | [`docs/writing-style.md`](./docs/writing-style.md); academic work adds [`academic-writing-style.md`](./docs/academic-writing-style.md); a piece spec adds [`packages/writing/AGENTS.md`](./packages/writing/AGENTS.md) |
| Editing a prose doc or AGENTS.md: which file a fact belongs in | [`docs/agents/prose-files.md`](./docs/agents/prose-files.md) |
| Issues and labels | [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md), [`docs/agents/triage-labels.md`](./docs/agents/triage-labels.md) |
| Domain vs architecture vocabulary | [`docs/agents/domain.md`](./docs/agents/domain.md) |
| A slash-named skill not in the listing | `.claude/skills/<name>/SKILL.md` (this repo's own), else the `mattpocock-skills` plugin (`mattpocock-skills:<name>`). Never a similarly-named substitute. `grill-with-docs` means grilling + domain-modeling. |
