# Agent instructions for this repo

An npm-workspaces root: `packages/framework` (`@byronbroughten/sheets-framework`, a clone of its own repo), a TypeScript framework for typed apps on Google Sheets + Apps Script, and `packages/real-estate` (`sheets-real-estate`, a clone of its own repo), the real-estate endpoints built on it; a live spreadsheet is both database and UI. `packages/writing` (`writing`, a clone of its own private repo) is where prose piece specs are filed.

Open only the section or disclosed doc the task needs.

## Commands

- `npm run check`: always safe. It runs the type check, tests and lint at once and skips them when the same committed files already passed; run it before calling a change done, and treat a new type error as yours unless a clean checkout has it too. `npm run tsc`, `npm test` and `npm run lint` each run one check alone.
- **What needs a yes follows what it costs to undo: [the tier list](./docs/targets-and-gates.md#which-tier-an-action-is-in).** Every live-spreadsheet command names its target, `dev:*` or `app:*`, and `app:gen:configs` has [four conditions](./docs/targets-and-gates.md#gen-configs-standing-permission) to check first.
- `npm run app:probe`: read-only raw Sheets JSON. Stdout gets a summary and the full response goes to that package's `.probe/last.json`; read a line range of it, never print a full body into the chat.

## Every task

- **README.md is for humans.** Nothing in it is needed for a task here; open it only to keep it accurate ([`docs/agents/prose-files.md`](./docs/agents/prose-files.md)).
- **Which package: first "would this make sense with no Sheets at all?" Yes: `packages/utils`, never started in the framework. Then "in a different Sheets-backed app?"** Yes: `packages/framework`. No: `packages/real-estate`. A lint, format or tsconfig setting any TypeScript project would want: `config`. A reader-facing Piece: `packages/writing`.
- **Public repos never depend on private ones; private may depend on public.**
- **Working in a folder with its own `AGENTS.md`**, read it first; each package's `src/` and several folders under it have one.
- **Every edit happens in a workspace**, opened with `/start-issue <repo> <n>`, which moves this session in and starts `/implement-code`, or `npm run issue:start -- <repo> <n>` (or `-- --session <slug>`) and closed out with `npm run wrap-up` on the same arguments.
- **Commit freely; push only through wrap-up, or with a yes. Implement a spec on its `issue-<n>-<slug>` branch**, even when a skill says to commit to the current branch. Starting a runner run is the yes for what the runner's own code writes on that spec's issue tree in the named repo: comments, closing its tickets, pushing `issue-*` branches and wrap-up merges, and for the implement step's `gh issue edit` and `gh issue comment` as the ticket describes them; never for an agent step closing an issue or changing a triage label on a ticket of the running spec, a write outside its ticket's targets, or any other write an agent step attempts. Branch rules: [`docs/agents/git-workflow.md`](./docs/agents/git-workflow.md).

## Read by task

| When | Open |
| --- | --- |
| Placing a file, import, or member; naming an accessor; profile vs Table; Raw, Identified or Named | [`packages/framework/src/AGENTS.md`](./packages/framework/src/AGENTS.md) + [vocabulary](./packages/framework/docs/vocabulary.md) |
| Writing or refactoring TypeScript, tests included | [`config/docs/code-style.md`](./config/docs/code-style.md), then for framework or app code [`packages/framework/docs/code-style.md`](./packages/framework/docs/code-style.md) |
| Operator-facing words: endpoint, selector, run state; units, the ledger | [`GLOSSARY-MAP.md`](./GLOSSARY-MAP.md), then that package's `GLOSSARY.md` |
| Real-estate endpoints or app chores | [app `src/AGENTS.md`](./packages/real-estate/src/AGENTS.md) |
| Arguing that a gap is deliberate, or proposing a design principle | [design](./packages/framework/docs/design.md) |
| Architecture mechanics: dispatch, schema classes, class chains, queued writes, round trips, type-check cost | [architecture](./packages/framework/docs/architecture.md) index, then one file |
| Adding a deletion path | [blank-row](./packages/framework/docs/architecture/blank-row.md) |
| A one-off job against the live sheet | [chores](./packages/framework/docs/architecture/chores.md) |
| Hosts, bin, chore dry run, Sheets probe, gworkspace MCP | [how-it-runs](./packages/framework/docs/how-it-runs.md); gates: [targets-and-gates](./docs/targets-and-gates.md) |
| Runner code (`runner/`), `SpecRun.ts` included | [`runner/src/AGENTS.md`](./runner/src/AGENTS.md) |
| Claude Code hooks and the project agent | [`docs/claude-code-guardrails.md`](./docs/claude-code-guardrails.md) |
| Tests and fakes | [testing](./packages/framework/docs/testing.md) |
| Regen `tsc` fails, or hand-written sheet/column keys disagree with generated configs | [retarget-after-gen-configs](./.claude/skills/retarget-after-gen-configs/SKILL.md) |
| Branches, landing a spec, closing an issue, `backup/*` or `research/*` branches | [`docs/agents/git-workflow.md`](./docs/agents/git-workflow.md) |
| Design, grilling, specs, tickets, a long session's handoff | [`docs/agents/planning.md`](./docs/agents/planning.md) |
| Writing reader-facing prose: a shared Google Doc, a blog post, in-app text, a piece spec | [`docs/writing-voice.md`](./docs/writing-voice.md) and [`docs/writing-craft.md`](./docs/writing-craft.md); academic work adds [`academic-writing-style.md`](./docs/academic-writing-style.md); a piece spec adds [`packages/writing/AGENTS.md`](./packages/writing/AGENTS.md) |
| Editing a prose doc or AGENTS.md: which file a fact belongs in | [`docs/agents/prose-files.md`](./docs/agents/prose-files.md) |
| Issues and labels | [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md), [`docs/agents/triage-labels.md`](./docs/agents/triage-labels.md) |
| A yes/no, pick-one or scale judgement an agent could hand off | [`docs/agents/jev.md`](./docs/agents/jev.md) |
| Domain vs architecture vocabulary | [`docs/agents/domain.md`](./docs/agents/domain.md) |
| A slash-named skill not in the listing | `.claude/skills/<name>/SKILL.md`. Never a similarly-named substitute. |
| Editing, forking or syncing a vendored skill | [`docs/agents/upstream-skills.md`](./docs/agents/upstream-skills.md) |
