# Which prose file a fact belongs in

Every file has one job, and each fact lives in exactly one of them. Everywhere else, point to it. The one exception is a behavior-changing rule, repeated on purpose where it gets followed. Why the scheme is shaped this way: [`docs/agent-behavior-design.md`](../agent-behavior-design.md).

## Terms

- **Rules file**: an index file under `docs/`, `config/docs/` or `packages/*/docs/` of bolded one-line rules (`config/docs/code-style.md`, and the framework's `docs/code-style.md`, `docs/vocabulary.md` and `docs/design.md`, and the root's `docs/writing-style.md` and `docs/academic-writing-style.md`), with one-sentence scope, the fixed sentence on when to open reasoning, and a "When | File" table under `## Reasoning files` into its reasoning folder. A rule line carries only the rule: the bolded rule plus at most a short clause of scope or its one exception. It must be both brief and clear, and no length cap stands in for either. Examples, instances, citations and the why go in its reasoning file.
- **Reasoning file**: a file under a rules file's `docs/<name>/` folder holding the why, examples, instances and history. It is never auto-loaded. A rules-file section with anything beyond its rules gets one.
- **Router**: the Read-by-task table in the root AGENTS.md. It is the only one, with rows into every package.
- **Nested AGENTS.md**: a folder's own rules, loaded when an agent works there, paired with a one-line `CLAUDE.md` holding `@AGENTS.md`.
- **Mechanics doc**: a reference file under `docs/` or `packages/*/docs/` read by heading. It opens with a lead of 5 lines and 800 bytes or fewer, and any such file over 4 KB must have `##` headings (lint checks both; a shorter doc with no heading is read whole). Its headings are specific enough to grep, and a rule found in it moves up to a rules file or nested AGENTS.md, leaving a pointer. One that covers subjects sharing nothing is split and indexed.
- **Enforcement ladder**: lint > path-triggered (nested AGENTS.md, a hook) > router pointer > prose.
- **Reader-facing prose**: text written for a reader who is neither the developer nor an agent, and not for development work: shared or published Google Docs, blog posts, in-app text and academic writing. It follows [`docs/writing-style.md`](../writing-style.md).
- **Derived view**: a file that restates facts whose home is elsewhere, for another audience. README.md is one.

## Map

### Root

| File | Holds |
| --- | --- |
| `AGENTS.md` | Only what changes an agent's behavior on every task: commands, gates, git rules, the README line, the router. Loaded every turn; read [What an addition to AGENTS.md costs](#what-an-addition-to-agentsmd-costs) before growing it. |
| `CLAUDE.md` | `@AGENTS.md` plus pointers to Claude Code-only mechanics (subagents, hooks). |
| `GLOSSARY-MAP.md` | Which `GLOSSARY.md` each context owns, how the app's glossary relates to the framework's, and that writing's relates to neither. |
| `docs/agent-behavior-design.md` | Why the agent tooling (hooks, gates, delegation, this doc scheme) is shaped as it is. It never goes in the framework's `docs/design.md`. |
| `docs/targets-and-gates.md` | The `dev`/`app` targets, what needs a yes first, the agent account, and the gworkspace MCP rules. |
| `docs/claude-code-guardrails.md` | The Claude Code hooks and project agent. |
| `docs/cursor-guardrails.md` | The Cursor hooks. |
| `docs/writing-style.md` | The voice of reader-facing prose, one line per rule, rule only, one voice with no sections per medium. Its `## Axes` section defines the Evidence and Formality values and the Academic overlay; a rule scoped to one value starts with that value as a code tag. |
| `docs/writing-style/*.md` | Each rule's quoted instances and sources, indexed by `docs/writing-style.md`'s "When \| File" table, plus `sources.md` for the sources read and the habits dropped. |
| `docs/academic-writing-style.md` | Academic conventions layered on `docs/writing-style.md`, one line per rule, rule only, with APA 7 as the citation standard. |
| `docs/academic-writing-style/*.md` | Each rule's quoted instances and sources, indexed by `docs/academic-writing-style.md`'s "When \| File" table. |
| `docs/agents/*.md` | Agent workflow: git, planning, delegation, issues, vendored upstream skills, handing judgements to Jev and its trial log. |
| `README.md` | The workspace overview, a derived view for people on GitHub; it links each public clone by github.com URL, since the clones don't exist there, and names the private writing clone without a link. Nothing routes agents to it. Update it when a fact it mirrors changes (tables below). |

### Framework (`packages/framework/`, its own repo)

Its `docs/`, `GLOSSARY.md`, `README.md`, `AGENTS.md` and `CLAUDE.md` files all ship with the package's repo, so they link only inside it (its own lint); a rule that lives at root is named in plain text. The root's linter checks `config/`'s docs and README.md the same way.

| File | Holds |
| --- | --- |
| `CLAUDE.md` | Only the restart-at-root notice for a session started inside the package. |
| `src/AGENTS.md` | Rules an agent can only break by touching `src/`: the tiers, downward dependencies, the boundary question, host and platform neutrality, generated data. Kept short: it loads on every `src/` task. |
| `src/chores/`, `src/00_Source/GoogleSheets/`, `src/01_SpreadsheetSchema/`, `src/02_SpreadsheetRaw/`, `src/06_API/` and `scripts/` `AGENTS.md` | That folder's rules, kept short because they load on every task there, each with a `CLAUDE.md` beside it. |
| `GLOSSARY.md` | Operator-facing words every app on the framework shares: sheet layout, endpoints, columns. Each term is a definition of what it is, its relationships and its avoid-aliases; what the app does with it goes in the mechanics doc that owns that behavior. |
| `docs/code-style.md` | Code shape that names Sheets, a tier, `Val` or a framework path, one line per rule, rule only, layered on the config package's general style doc. It names that doc in plain text, since published docs link only inside the package. |
| `docs/code-style/*.md` | Each rule's reasoning, examples and instances, indexed by `docs/code-style.md`'s "When \| File" table. |
| `docs/vocabulary.md` | The architecture words, one line per term. |
| `docs/vocabulary/*.md` | Each term's elaboration, split by subject, indexed by `docs/vocabulary.md`'s "When \| File" table. |
| `docs/design.md` | Why the codebase is shaped as it is, including deliberate absences, one line per principle. Covers the codebase only. |
| `docs/design/*.md` | Each principle's argument and instances, one file per principle, plus `candidates.md` for the parked ones. |
| `docs/architecture/*.md` | Mechanics, one file per heading, indexed by `docs/architecture.md`. |
| `docs/how-it-runs.md` | The two hosts, the rollup preset, the `sheets-framework` bin, the dev project, the chore dry run, auth failure, the probe, what the gworkspace MCP can see. |
| `docs/generated-data.md`, `docs/generated-data/*.md` | The generated configs: the index and regen path, then one file per constant, the config sync and the floor. |
| `docs/testing.md` | The fakes, the seams and the exemplar columns. |
| `README.md` | The consumer's face: install, the public entry, the bin. A derived view like the root one (table below). |

### App (`packages/real-estate/`, its own repo)

The same as the framework's: its docs ship with its repo, so they link only inside it (its own lint), link the framework's docs by github.com URL, and name a rule that lives at root in plain text.

| File | Holds |
| --- | --- |
| `CLAUDE.md` | Only the restart-at-root notice for a session started inside the package. |
| `GLOSSARY.md` | The app's operator-facing words (units, the occupancy ledger). It opens with a pointer to the framework glossary, links to a framework term rather than redefining it, and lists same-word conflicts under "Same word, two meanings". |
| `docs/occupancy-ledger.md` | How the occupancy ledger is built, beyond GLOSSARY.md's words for it. |
| `src/AGENTS.md` | Rules an agent can only break by touching the app's `src/`: the boundary question, the one framework import, generated data. Kept short, with a `CLAUDE.md` beside it. |
| `src/businessEndpoints/` and `src/chores/` `AGENTS.md` | That folder's rules, kept short, each with a `CLAUDE.md` beside it. The chore gates for `app:chore` live in `src/chores/`. |
| `README.md` | A short derived view: what the app is, how it builds, its folders, its `app:*` commands (table below). |

### Utils (`packages/utils/`, its own repo)

| File | Holds |
| --- | --- |
| `CLAUDE.md` | The restart-at-root notice, plus `@AGENTS.md`. |
| `AGENTS.md` | How a utility is written: bundle names, where a utility type lives, `for…in`, and the structural-cast escape hatch. |
| `README.md` | What the package is, install, and the subpath imports. A derived view of its `package.json`. |

### Writing (`packages/writing/`, its own repo)

A private repo holding piece specs as issues; the Pieces' text lives in their Google Docs, never here. Its docs link only inside it (its own lint) and name a root doc in plain text.
| File | Holds |
| --- | --- |
| `CLAUDE.md` | The restart-at-root notice, plus `@AGENTS.md`. |
| `AGENTS.md` | The pointer to the grilling doc, and how to implement a piece spec: the Deliverable as the text's only home, Drive IDs, the Deliverable's standing yes, the voice, the pointer to the wrap-up, and the four done checks. Kept short: it loads on every task there. |
| `GLOSSARY.md` | The writing context's words: Piece, Deliverable and Reference. |
| `docs/grilling.md` | What a grill asks before a piece spec is filed, and the calibration paragraph. `/to-writing-style` adds questions to it. |
| `docs/wrap-up.md` | The wrap-up prompt for a piece spec with no branch. |
| `docs/model-fit.md` | The outcome log for piece specs: pair, peak context and whether review revised it. |

### Config (`config/`)

| File | Holds |
| --- | --- |
| `README.md` | What the package exports and how a project consumes each piece. A derived view of its `package.json` and the files it exports. |
| `docs/code-style.md` | General code shape for any TypeScript project, one line per rule, rule only. It ships with the package, so it names no framework or app path as a link. |
| `docs/code-style/*.md` | Each rule's reasoning, examples and instances, indexed by `docs/code-style.md`'s "When \| File" table. |

## What an addition to AGENTS.md costs

No byte cap stands in for judgment here: a cap becomes a target, and an agent at the cap scatters its pointers into other files instead of deciding whether the fact belongs. Weigh the addition yourself.

- **Every byte is paid on every turn**, by every agent and every task, including the ones that never touch the fact. `CLAUDE.md` imports the file, so Claude Code loads all of it; Codex and Cursor read it directly. Roughly 4 bytes is a token.
- **Each addition dilutes the rest.** A rule competes for attention with the rules already there, so the file's most important gates weaken as it grows.
- **A rule left out is followed only if a pointer reaches it.** That is the case for a router row, not a reason to skip the row. A fact that matters only for some tasks goes on a higher rung ([enforcement ladder](#terms)): lint, a nested `AGENTS.md`, or a trigger word added to an existing router row.
- **Add to it only when the fact changes what an agent does on nearly every task, or a miss is costly and can't be cheaply undone.** When you add, shorten or drop a line that no longer earns its place, and state the net bytes in your reply so the operator can judge.

## What README.md mirrors

`grep '^#' README.md` shows a README's shape without reading it.

### The root README.md

| README section | Mirrors |
| --- | --- |
| Opening paragraph | What the project manages: the app's `GLOSSARY.md` |
| The packages | Each package's `package.json` and README opening; the boundary question: root `AGENTS.md` |
| Architecture: the numbered tiers | The tier list: `packages/framework/src/AGENTS.md`; the words: the framework's `docs/vocabulary.md` |
| Two spreadsheets | The root `package.json` scripts and [`targets-and-gates.md`](../targets-and-gates.md#targets-dev-and-app) |
| Words | `GLOSSARY-MAP.md` |
| Testing | [`testing.md`](../../packages/framework/docs/testing.md) |
| Known rough edges | The properties-probe blind spot: [`round-trips.md`](../../packages/framework/docs/architecture/round-trips.md) and `SpreadsheetRaw`'s placement reporter |

### The framework's README.md

| README section | Mirrors |
| --- | --- |
| Opening paragraph | What the package is: its `package.json` description |
| Install | `peerDependencies` and `exports` in its `package.json` |
| The public entry | `src/framework.ts` and `src/frameworkTesting.ts` |
| The bin | The bin's usage text (`scripts/cli.ts`) and [`how-it-runs.md`](../../packages/framework/docs/how-it-runs.md#the-sheets-framework-bin) |
| Docs | The framework's `docs/` indexes and `GLOSSARY.md` |
| History | Nothing; a fixed link to `byronbroughten/byro-repo` for the history before the split |

### The writing repo

It has no README: a private repo has no outside reader.

### The app's README.md

| README section | Mirrors |
| --- | --- |
| Opening paragraph | What the app manages: its `GLOSSARY.md` |
| Building it | Its `package.json` dependencies and the root's workspaces |
| What's here | The app's `src/AGENTS.md` and its `GLOSSARY.md` and `docs/` |
| Commands | The root `package.json`'s `app:*` scripts and [`targets-and-gates.md`](../targets-and-gates.md#targets-dev-and-app) |
| History | Nothing; a fixed link to `byronbroughten/byro-repo` for the history before the split |

A fact the environment already states, whether in `package.json`, a config file or `--help`, stays there; a doc restating it is a cache that goes stale. `npm run lint` checks the links, the leads and the headings above with the `lint-docs` bin from `config/`, which the config package's README describes. The root runs it with `--published config` and each clone's repo with `--published .`, which holds each package's published docs (its `docs/`, `GLOSSARY.md`, `README.md`, `AGENTS.md` and `CLAUDE.md`) to links inside that package. The root's `npm run lint` runs every clone's `lint:docs` too.
