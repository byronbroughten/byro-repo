# Agent-behavior design

Why the agent tooling around this repo is shaped the way it is: the hooks, gates, delegation rules and helper commands that decide how agents work here. [docs/design.md](../packages/framework/docs/design.md) holds the arguments for the codebase itself; this file holds the arguments for how agents work on it. The mechanics live in [`docs/claude-code-guardrails.md`](./claude-code-guardrails.md) and the rules in [AGENTS.md](../AGENTS.md) and [`docs/agents/`](./agents/).

The citation rule is the same as packages/framework/docs/design.md's. Every principle cites the decisions that produced it, by issue where one exists and by commit otherwise. A candidate with only one citation is parked at the bottom until a second decision makes the same argument.

## Principles

### Block narrowly, and name the way through; nudge everything else

A block that starves the agent of information costs more than it saves: the agent retries, works around it, or stalls. So a hard block is kept for a pattern that is both narrow and never right, and its message names the route that is allowed. Anything that is only usually wrong gets a reminder instead. Every guard fails open, so a bug in a hook can't stop unrelated work.

_Instances:_ the `Read` deny on `columnConfigs.ts` comes paired with the route through it, which is to grep the sheet key and read that one object (`a7810dd`). The Bash-read guard blocks exactly two patterns, each deny message names the alternative, and a command it can't parse is allowed. The per-turn read count only reminds, and it never cuts off a turn (#53). An edit inside the generated folder is usually wrong but not never, since the config-sheet floor is hand-edited, so it draws a warning rather than a block (#71). The first edit to the root AGENTS.md draws a cost reminder, not a block or a required read: growing the file is sometimes right, and the reminder is small enough to inject where the style gate's is not (#156). The primary-edit guard denies only a file edit or `git commit` in a primary checkout, passes the gitignored paths a session still writes there, and its deny names both `issue:start` commands and says to continue at the printed path (#257).

### Primary checkouts take no edits; every edit happens in a workspace

Parallel sessions share one set of primary checkouts, so one session's branch switch moves another's, and runs land into those same checkouts, so a session's uncommitted edit there can collide with a landing or get mixed into it. So no session edits a primary checkout or moves its branch. Each ticket is implemented in its own issue workspace, any other work in a session workspace, and a primary only fast-forwards when a workspace lands.

The guards, `branchGuard.ts` and the primary-edit guard, decide where an edit or commit happens, not whether it needs a yes, so the tiers leave them alone: a commit stays free once it is in a workspace.

_Instances:_ the branch guard went strict once the runner gave each ticket its own workspace (#238). Session workspaces, leases, `wrap-up -- --session` and the primary-edit guard ended the exception that let docs, grilling and mining edit master in a primary checkout (#257).

### Gate by what it costs to undo

Whether an action needs the developer's yes follows from one question: what would undoing it cost? An action git can undo is free, a commit on any branch included. An action whose undo point is Google's version history is free too: an `app:*` or `dev:*` live command, a new Drive file, or a write to a Sheet, Doc or Drive file one of the developer's accounts owns. An action that can't be undone, or that reaches someone else, asks: a raw push, a publish, a sharing change, a write to someone else's file, spending money, touching credentials. Which action sits in which tier is listed in [`docs/targets-and-gates.md`](./targets-and-gates.md#which-tier-an-action-is-in).

The session mode decides what an ask does. An Interactive session asks the developer. A runner step has nobody to answer, so its call is refused with a reason, and the step records a blocker and carries on. A stalled run has cost more than any action an agent has taken.

The gates are designed against a fallible agent: one that means well and makes a mistake. #268 keeps Untrusted text out of agents' instructions, and hardening against the agent itself waits for its containment triggers (below), so no such gate is built ahead of them.

Quality checks and cost guards are not gates, and the tiers leave them alone: lint feedback, the style gate, the formatter, the read guards and the generated-file read deny.

_Instances:_ every `app:*` write, every Docs write without a Deliverable grant and every commit once waited for a yes, while a push that could leak a secret to a public repo got no more protection than a sheet edit; one tier decision replaced those rules (#273, #274, #276). Runner steps get refusals, not prompts (#277). The one push with a standing yes, `npm run wrap-up`'s, scans its outgoing lines for token shapes first, since a pushed token is the mistake no undo fixes (#275). A session landing, `npm run wrap-up -- --session`, pushes behind the same scan as an issue landing (#257). A plain `issue:remove` is free because it refuses unlanded work, while `issue:remove --force` asks, since the work it discards can't be brought back (#257).

### Keep the payload on disk and the summary in context

Whatever enters the context is paid for on every later turn. A full payload, printed once, rides along through unrelated work. Show a summary that is enough to decide the next step, and keep the complete record somewhere a ranged read can reach it, so the summary never hides needed detail.

_Instances:_ a chore dry run prints one rendered line per request, and `-- --json` is the escape hatch for when a line looks wrong (the framework's `docs/how-it-runs.md`, "The chore and its dry run"). `npm run app:probe` prints keys, counts and sheet titles, and writes the full response to `.probe/last.json` for a ranged `Read` (#53).

### Delegate the reading, not the judgment

A dispatched agent starts cold and sees only what it is handed, so it is good at finding things and poor at deciding what they mean. Send out work that reads a lot and returns a little. Keep the diagnosis, and any action that needs the operator's yes, in the session that holds the task context.

_Instances:_ dispatched agents report the command they would run rather than running a gate, and must return `file:line` with verbatim quotes ([`docs/agents/delegation.md`](./agents/delegation.md), `d6b8ae3`). `repo-explorer` runs on Sonnet with read-only tools, and it locates code without diagnosing (#53). A `ready-for-agent` ticket keeps the design forks and flush shapes with its writer, and the implementer carries them out: #80 left its flush and naming rules to be inferred, and #89 had to restate them (#91).

### Approval covers what was named, and nothing next to it

A yes is scoped to the specific thing the operator saw. A general go-ahead, or approval of a neighbouring step, is not consent to an action whose effects they didn't see named.

_Instances:_ a share needs its own yes naming who gets access and at what permission, apart from any data-write approval (#273). During design or grilling, nothing is written until the operator invokes the skill that files it: approving a design is not approving its publication (`5d5c77c`).

### Put each rule where it gets followed, and its reasoning one pointer away

What an agent loads without asking is paid for on every task, and a rule it has to go looking for is a rule it skips. So a behavior-changing rule is placed wherever it gets followed, even at the cost of repeating it, and the reasoning, examples and history are never auto-loaded: they sit exactly one pointer from the rule, behind the fixed sentence "Open a reasoning file only when you're changing the rule, or the rule's line doesn't decide your case". A rule goes on the highest rung it can reach: lint, then path-triggered (a nested `AGENTS.md`, a hook), then a router pointer, then prose. Lint needs no reader at all, and a path trigger reaches only the agents touching that folder. Hooks only reinforce, and no rule lives only in a hook, because more than one agent works this repo. Cursor denies the same way Claude does (#167): a code edit waits for a full read of config/docs/code-style.md, and a framework or app file also waits for packages/framework/docs/code-style.md. A nested `AGENTS.md` is what Codex and Cursor read, and it is paired with a one-line `CLAUDE.md` importing it because Claude Code, with a root `CLAUDE.md` present, loads a subfolder's `CLAUDE.md` on demand but not its `AGENTS.md`. README.md is a derived view for people: routing agents through a 30 KB pitch cost more than the few facts they needed from it, so those facts moved to their homes and README mirrors them. The STYLE gate denies rather than injecting config/docs/code-style.md: an injection would pay the whole file on every first edit, even when it is already in context, whereas a deny names one read and leaves the agent to take it once. It counts only a Read that covers the whole file, since a gate a five-line read unlocks is no gate.

A rules file holds only the rule: a rule line is the bolded rule plus at most a clause of scope or its one exception, and every example, instance, citation and why sits in the reasoning file. That convention replaced a 300-character cap on rule lines. The cap became a target: rules clustered just under it, padded with an example or a second clause to fill it, or squeezed to fit it, so it bought neither brevity nor clarity. Brevity and clarity are held together by the written convention and by review instead, because a number can measure only one of them. The size caps on AGENTS.md files failed the same way: an agent 2 bytes under the root cap left it unchanged and spread the pointer over eslint.config.mjs, the README and prose-files.md (#156). They gave way to a stated cost, which is that every byte is paid on every turn and dilutes the rest, so the agent adding to the file weighs that itself ([`prose-files.md`](./agents/prose-files.md#what-an-addition-to-agentsmd-costs)). A lead is capped in bytes as well as lines, since a line count lets one long paragraph through, and a doc over 4 KB needs `##` headings, since a doc with none is one long lead read whole.

_Instances:_ the style doc was followed more consistently once it became one line per rule with the reasoning under `docs/code-style/` (`a7810dd`), and the same shape now holds packages/framework/docs/vocabulary.md; `src/`-only rules left the root AGENTS.md for `src/AGENTS.md`; the tier rule and the doc structure's limits moved to `npm run lint`; editing code without opening the style doc, the most common miss, got the gate (#108); Cursor's copy of that gate also requires the framework style doc on framework and app code, because a pointer in `.cursor/rules` was not a read (#167); the rule-line cap gave way to the rule-only convention, and the style doc's trailing examples moved to `docs/code-style/` (#110); the AGENTS.md size caps gave way to a stated cost of adding (#156).

## Untrusted text

Trusted text and Untrusted text are defined in [`runner/GLOSSARY.md`](../runner/GLOSSARY.md). For now, the stance is to keep Untrusted text out of an agent's instructions with cheap mechanical checks, and to leave containment for later. Containment means a step can't do harm even after it is misled. Runner steps read issues only through `npm run issue:read` with `--hide-others`, which labels each part and replaces other people's comments with a count, so the prompt no longer asks the model to work out who wrote what (#269). A pieces runner will read Doc comments the same way, through a labelled reader like `issue:read` (#273).

Containment gets built when any one of these happens:

1. The runner starts working tickets the developer didn't write.
2. A runner step gains web access, or access to content someone else can edit or comment on.
3. Untrusted text is caught trying to instruct an agent.

No Drive-permission check is added, because sharing a Doc or Sheet already needs its own yes ([the tier list](./targets-and-gates.md#which-tier-an-action-is-in)). A Sheet's cell values are always data, even in a Sheet only the developer can edit. A merge to master is where text becomes trusted: content committed to master in one of the developer's repos is Trusted text, and a branch is not until it lands.

## Not yet promoted

- **End a fat session with a written handoff, not a longer turn.** Past a size threshold, a finished diagnosis is written down (the conclusion, the files and ranges to open, the hypotheses ruled out) and a fresh session starts from it. A small diagnosis in a lean session skips this. _Cited by:_ #53.
- **A spec whose premise fails is escalated, not worked around.** When a ticket's placement can only be met with plumbing that exists to get around it, the conflict goes to the developer before the code is written, not into a departure note afterward. _Cited by:_ #84.
- **Split a big spec into Phases rather than bigger tickets with more handoffs, and ticket one Phase at a time.** Each handoff pays the fixed reads again, a large ticket runs every piece at its hardest piece's pair, handoffs are written under context pressure, and tickets written ahead of real use get reshaped or dropped. The runner stays Phase-unaware: a Phase gate is one more `ready-for-human` blocker, closed only by `/code-tickets` because a gate closed by hand lets the gap check run while later Phases are unticketed. Handoffs stay the fallback for a ticket that outgrows its estimate. _Cited by:_ #213's staging pass (#246–#250), decided in #251.
