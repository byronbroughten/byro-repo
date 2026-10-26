# Which prose file a fact belongs in

The words for the repo's prose, which file holds which fact, what the root AGENTS.md costs, and what each README mirrors. The rules for shaping developer-facing prose, one home per fact included: [`docs/prose-style.md`](../prose-style.md).

## Terms

- **Rules file**: an index file under `docs/`, `config/docs/` or `packages/*/docs/` of bolded one-line rules (`config/docs/code-style.md`, and the framework's `docs/code-style.md`, `docs/vocabulary.md` and `docs/design.md`, and the root's `docs/prose-style.md`, `docs/writing-voice.md`, `docs/writing-craft.md`, `docs/academic-writing-style.md` and `docs/agents/verdicts.md`), with one-sentence scope, the fixed sentence on when to open reasoning, and a "When | File" table under `## Reasoning files` into its reasoning folder.
- **Reasoning file**: a file under a rules file's `docs/<name>/` folder holding the why, examples, instances and history.
- **Router**: the Read-by-task table in the root AGENTS.md. It is the only one, with rows into every package.
- **Nested AGENTS.md**: a folder's own rules, loaded when an agent works there, paired with a one-line `CLAUDE.md` holding `@AGENTS.md`.
- **Mechanics doc**: a reference file under `docs/` or `packages/*/docs/` read by heading.
- **Enforcement ladder**: lint > path-triggered (nested AGENTS.md, a hook) > router pointer > prose.
- **Developer-facing prose**: prose written for the developer or an agent doing development work. AGENTS.md and CLAUDE.md files, skills, docs, GLOSSARY files and ADRs are developer-facing prose; code comments follow the code style rules, and commit messages and issue or spec bodies are neither. It follows [`docs/prose-style.md`](../prose-style.md).
- **Reader-facing prose**: text written for a reader who is neither the developer nor an agent, and not for development work: shared or published Google Docs, blog posts, in-app text and academic writing. It follows [`docs/writing-voice.md`](../writing-voice.md) and [`docs/writing-craft.md`](../writing-craft.md).
- **Derived prose**: prose that restates facts whose home is elsewhere, for onlookers rather than development work. Each README is derived prose.

## Map

### Root

| File | Holds |
| --- | --- |
| `AGENTS.md` | Only what changes an agent's behavior on every task: commands, gates, git rules, the README line, the router. Loaded every turn; read [What an addition to AGENTS.md costs](#what-an-addition-to-agentsmd-costs) before growing it. |
| `CLAUDE.md` | `@AGENTS.md` plus pointers to Claude Code-only mechanics (subagents, hooks). |
| `GLOSSARY-MAP.md` | Which `GLOSSARY.md` each context owns, how the app's glossary relates to the framework's, and that writing's, the inbox's and the runner's relate to neither. |
| `docs/agent-behavior-design.md` | Why the agent tooling (hooks, gates, delegation, this doc scheme) is shaped as it is, each principle citing ADRs. It never goes in the framework's `docs/design.md`. |
| `docs/adr/*.md` | One agent-behavior decision per file, in the `domain-modeling` skill's ADR format with its `Source:` line. Each repo has its own `docs/adr/`, created with its first ADR. |
| `docs/targets-and-gates.md` | The tier list of what needs a yes first, ticket targets, the `dev`/`app` targets, the agent account, and the gworkspace MCP rules. |
| `docs/claude-code-guardrails.md` | The Claude Code hooks and project agent. |
| `docs/pdf-pages.md` | How a piece stage reads a long PDF by page: download it, count its pages, print a page range, PDF against printed pages, and delete the download. Shared by every piece skill, since user-invoked skills can't reach each other. |
| `docs/prose-style.md` | How developer-facing prose is shaped, one line per rule, rule only: one home per fact, rule lines, reasoning files, mechanics docs, placement and the AGENTS.md bar, then the `## Smells` baseline with its two derived-prose rules. |
| `docs/prose-style/*.md` | Each rule's reasoning and examples, indexed by `docs/prose-style.md`'s "When \| File" table. |
| `docs/writing-voice.md` | The voice of reader-facing prose, one line per rule, rule only, one voice with no sections per medium. Its `## Axes` section defines the Evidence and Formality values and the Academic overlay; a rule scoped to one value starts with that value as a code tag. |
| `docs/writing-voice/*.md` | Each rule's quoted instances and sources, indexed by `docs/writing-voice.md`'s "When \| File" table, plus `sources.md` for the sources read and the habits dropped. |
| `docs/writing-craft.md` | Rules any skilled writer follows in reader-facing prose, whatever their voice, one line per rule, rule only, opening with a `## Terms` section of one line per term, then the `## Precedence` rule for a clash with a Voice habit. |
| `docs/writing-craft/*.md` | Each rule's before-and-after example and the chapter and page it came from, indexed by `docs/writing-craft.md`'s "When \| File" table. Which books were read, and when, is in `docs/writing-voice/sources.md`. |
| `docs/academic-writing-style.md` | Academic conventions layered on `docs/writing-voice.md` and `docs/writing-craft.md`, one line per rule, rule only, with APA 7 as the citation standard. |
| `docs/academic-writing-style/*.md` | Each rule's quoted instances and sources, indexed by `docs/academic-writing-style.md`'s "When \| File" table. |
| `docs/agents/*.md` | Agent workflow: git, planning, delegation, issues, vendored upstream skills, handing judgements to Jev and its trial log. |
| `docs/agents/verdicts.md` | How any review finding is judged, one line per rule, rule only: the four verdicts and their reasons, the Standards and Spec rules, Halt, overruling a suggested verdict, and the approved exceptions. |
| `docs/agents/codebase-priorities.md` | What every Recommendation about the codebase or agent tooling is weighed against, one line per rule, rule only: scope, the Tier 1 gate, the floor, Tier 2's ranked priorities with their definitions, and explaining a tradeoff. |
| `docs/agents/codebase-priorities/*.md` | Each priority's pointers to the rules that express it and the floor's reason, and the Estimates index of measured costs, indexed by `docs/agents/codebase-priorities.md`'s "When \| File" table. |
| `docs/agents/verdicts/*.md` | Each rule's reasoning and examples, indexed by `docs/agents/verdicts.md`'s "When \| File" table. |
| `README.md` | The workspace overview, derived prose for people on GitHub; it links each public clone by github.com URL, since the clones don't exist there, and names the private personal clone without a link. Nothing routes agents to it. Update it when a fact it mirrors changes (tables below). |

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
| `docs/design/*.md` | Each principle's argument and instances, one file per principle. |
| `docs/adr/*.md` | One codebase decision per file, cited by `docs/design.md`'s principles. |
| `docs/architecture/*.md` | Mechanics, one file per heading, indexed by `docs/architecture.md`. |
| `docs/how-it-runs.md` | The two hosts, the rollup preset, the `sheets-framework` bin, the dev project, the chore dry run, auth failure, the probe, what the gworkspace MCP can see. |
| `docs/generated-data.md`, `docs/generated-data/*.md` | The generated configs: the index and regen path, then one file per constant, the config sync and the floor. |
| `docs/testing.md` | The fakes, the seams and the exemplar columns. |
| `README.md` | The consumer's face: install, the public entry, the bin. Derived prose like the root one (table below). |

### App (`packages/real-estate/`, its own repo)

The same as the framework's: its docs ship with its repo, so they link only inside it (its own lint), link the framework's docs by github.com URL, and name a rule that lives at root in plain text.

| File | Holds |
| --- | --- |
| `CLAUDE.md` | Only the restart-at-root notice for a session started inside the package. |
| `GLOSSARY.md` | The app's operator-facing words (units, the occupancy ledger). It opens with a pointer to the framework glossary, links to a framework term rather than redefining it, and lists same-word conflicts under "Same word, two meanings". |
| `docs/occupancy-ledger.md` | How the occupancy ledger is built, beyond GLOSSARY.md's words for it. |
| `src/AGENTS.md` | Rules an agent can only break by touching the app's `src/`: the boundary question, the one framework import, generated data. Kept short, with a `CLAUDE.md` beside it. |
| `src/businessEndpoints/` and `src/chores/` `AGENTS.md` | That folder's rules, kept short, each with a `CLAUDE.md` beside it. The chore gates for `app:chore` live in `src/chores/`. |
| `README.md` | Short derived prose: what the app is, how it builds, its folders, its `app:*` commands (table below). |

### Utils (`packages/utils/`, its own repo)

| File | Holds |
| --- | --- |
| `CLAUDE.md` | The restart-at-root notice, plus `@AGENTS.md`. |
| `AGENTS.md` | How a utility is written: bundle names, where a utility type lives, `for…in`, and the structural-cast escape hatch. |
| `README.md` | What the package is, install, and the subpath imports. Derived prose mirroring its `package.json`. |

### Writing (`packages/personal/writing/`, in the `personal` repo)

The `personal` repo is private and holds piece specs as issues; the Pieces' text lives in their Google Docs, apart from each Piece's Snapshot. Its docs link only inside it (its own lint) and name a root doc in plain text.
| File | Holds |
| --- | --- |
| `CLAUDE.md` | The restart-at-root notice, plus `@AGENTS.md`. |
| `AGENTS.md` | The pointers to `/grill-piece` and the outlining guide, and how to implement a piece spec: the Deliverable as the text's working home, Drive IDs and long PDFs, when a Deliverable write needs no yes, the style sheets to apply, a Piece's branch and landing, the pointer to the Snapshot doc, and the four done checks. Kept short: it loads on every task there. |
| `GLOSSARY.md` | The writing context's words: Piece, Deliverable, Section, Outline, Snapshot, Supporting Material and Reference. |
| `docs/grilling.md` | The questions a grill asks before a piece spec is filed, one per spec field it settles, each with an example from a past spec. `/grill-piece` asks them; `/to-writing-style` adds to them. |
| `docs/outlining.md` | How a spec's Outline is written: what each entry holds, a template's fixed Sections, and when Research revises it. |
| `docs/wrap-up.md` | The wrap-up prompt for a Research spec, which has no branch. |
| `docs/snapshots.md` | A Snapshot's path, its shape and how a save replaces its blocks. |
| `snapshots/` | One Snapshot per Piece, written by `/implement-piece` only. |
| `docs/model-fit.md` | The outcome log for piece specs: kind, pair and peak context. |

### Config (`config/`)

| File | Holds |
| --- | --- |
| `README.md` | What the package exports and how a project consumes each piece. Derived prose mirroring its `package.json` and the files it exports. |
| `docs/code-style.md` | General code shape for any TypeScript project, one line per rule, rule only. It ships with the package, so it names no framework or app path as a link. |
| `docs/code-style/*.md` | Each rule's reasoning, examples and instances, indexed by `docs/code-style.md`'s "When \| File" table. |

### Runner (`runner/`)

| File | Holds |
| --- | --- |
| `README.md` | What the runner is, its exports and how to run its tests. Derived prose mirroring its `package.json` and the files it exports. |
| `skills/<name>/SKILL.md` | An interactive skill for the runner's records, such as `/judge-findings` for the review list, loaded through `.claude/skills/` ([layout](./upstream-skills.md#layout)). |
| `GLOSSARY.md` | The words of an unattended spec run: its steps, records, verdicts and Halts, plus Primary checkout, the workspaces and Lease, which interactive sessions borrow, and Phase and Phase gate, which planning borrows. |

## What an addition to AGENTS.md costs

No byte cap stands in for judgment here: a cap becomes a target, and an agent at the cap scatters its pointers into other files instead of deciding whether the fact belongs. Weigh the addition yourself.

- **Every byte is paid on every turn**, by every agent and every task, including the ones that never touch the fact. `CLAUDE.md` imports the file, so Claude Code loads all of it; Codex and Cursor read it directly. Roughly 4 bytes is a token.
- **Each addition dilutes the rest.** A rule competes for attention with the rules already there, so the file's most important gates weaken as it grows.
- **A rule left out is followed only if a pointer reaches it.** That is the case for a router row, not a reason to skip the row. A fact that matters only for some tasks goes on a higher rung ([enforcement ladder](#terms)): lint, a nested `AGENTS.md`, or a trigger word added to an existing router row.

The bar for an addition: [`docs/prose-style.md`](../prose-style.md#placement).

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

### The personal repo

It has no README: a private repo has no outside reader.

### The app's README.md

| README section | Mirrors |
| --- | --- |
| Opening paragraph | What the app manages: its `GLOSSARY.md` |
| Building it | Its `package.json` dependencies and the root's workspaces |
| What's here | The app's `src/AGENTS.md` and its `GLOSSARY.md` and `docs/` |
| Commands | The root `package.json`'s `app:*` scripts and [`targets-and-gates.md`](../targets-and-gates.md#targets-dev-and-app) |
| History | Nothing; a fixed link to `byronbroughten/byro-repo` for the history before the split |

`npm run lint` checks the links, the leads and the headings above with the `lint-docs` bin from `config/`, which the config package's README describes. The root runs it with `--published config` and each clone's repo with `--published .`, which holds each package's published docs (its `docs/`, `GLOSSARY.md`, `README.md`, `AGENTS.md` and `CLAUDE.md`) to links inside that package. The root's `npm run lint` runs every clone's `lint:docs` too.
