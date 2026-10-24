# Agent-behavior design

Why the agent tooling around this repo is shaped the way it is: the hooks, gates, delegation rules and helper commands that decide how agents work here. [docs/design.md](../packages/framework/docs/design.md) holds the arguments for the codebase itself; this file holds the arguments for how agents work on it. The mechanics live in [`docs/claude-code-guardrails.md`](./claude-code-guardrails.md) and the rules in [AGENTS.md](../AGENTS.md) and [`docs/agents/`](./agents/).

Decisions are ADRs in [`docs/adr/`](./adr/), and every principle cites at least two from this repo; the issue and commit citations below predate them and await migration. A new ADR making a principle's argument is added to it as a link plus one clause. A new principle is proposed to the developer and added only once approved.

## Principles

### Block narrowly, and name the way through; nudge everything else

A block that starves the agent of information costs more than it saves: the agent retries, works around it, or stalls. So a hard block is kept for a pattern that is both narrow and never right, and its message names the route that is allowed. Anything that is only usually wrong gets a reminder instead. Every guard fails open, so a bug in a hook can't stop unrelated work.

_Instances:_ [ADR 0011](./adr/0011-hard-block-only-narrow-patterns-and-nudge-the-rest.md) hard-blocks only two read patterns, each naming its alternative, and leaves the read count and size warnings as reminders that never stop a turn. An edit inside the generated folder is usually wrong but not never, since the config-sheet floor is hand-edited, so it draws a warning rather than a block (#71). [ADR 0012](./adr/0012-replace-agents-md-size-caps-with-a-stated-cost-of-adding.md) meets the first edit to the root AGENTS.md with a cost reminder rather than a cap or a block, since growing the file is sometimes right. [ADR 0013](./adr/0013-every-edit-happens-in-a-workspace-never-a-primary-checkout.md) has the primary-edit guard deny only an edit or commit in a primary checkout, with `issue:start` named as the way through. [ADR 0009](./adr/0009-runner-steps-get-refusals-not-prompts.md) gives a runner step's refusal a reason that names its way through, recording a blocker, rather than leaving the step to stall.

### Primary checkouts take no edits; every edit happens in a workspace

Parallel sessions share one set of primary checkouts, so one session's branch switch moves another's, and runs land into those same checkouts, so a session's uncommitted edit there can collide with a landing or get mixed into it. So no session edits a primary checkout or moves its branch. Each ticket is implemented in its own issue workspace, any other work in a session workspace, and a primary only fast-forwards when a workspace lands.

The guards, `branchGuard.ts` and the primary-edit guard, decide where an edit or commit happens, not whether it needs a yes, so the tiers leave them alone: a commit stays free once it is in a workspace.

_Instances:_ [ADR 0013](./adr/0013-every-edit-happens-in-a-workspace-never-a-primary-checkout.md) moves every edit, ticket or not, out of the primary checkouts into a workspace, since one session's branch switch had moved another's checkout and runs land where sessions edited.

### Gate by what it costs to undo

Whether an action needs the developer's yes follows from one question: what would undoing it cost? An action git can undo is free, a commit on any branch included. An action whose undo point is Google's version history is free too: an `app:*` or `dev:*` live command, a new Drive file, or a write to a Sheet, Doc or Drive file one of the developer's accounts owns. An action that can't be undone, or that reaches someone else, asks: a raw push, a publish, a sharing change, a write to someone else's file, spending money, touching credentials. Which action sits in which tier is listed in [`docs/targets-and-gates.md`](./targets-and-gates.md#which-tier-an-action-is-in).

The session mode decides what an ask does. An Interactive session asks the developer. A runner step has nobody to answer, so its call is refused with a reason, and the step records a blocker and carries on. A stalled run has cost more than any action an agent has taken.

The gates are designed against a fallible agent: one that means well and makes a mistake. [ADR 0007](./adr/0007-keep-untrusted-text-out-of-instructions-and-defer-containment.md) keeps Untrusted text out of agents' instructions, and hardening against the agent itself waits for its [containment triggers](./adr/0007-keep-untrusted-text-out-of-instructions-and-defer-containment.md#consequences), so no such gate is built ahead of them.

Quality checks and cost guards are not gates, and the tiers leave them alone: lint feedback, the style gate, the formatter, the read guards and the generated-file read deny.

_Instances:_ [ADR 0008](./adr/0008-gate-agent-actions-by-what-they-cost-to-undo.md) replaces rule-by-rule asks with one tier decision by what an action costs to undo. [ADR 0009](./adr/0009-runner-steps-get-refusals-not-prompts.md) turns a runner step's ask into a refusal, since nobody is there to answer and a stalled run costs more. [ADR 0010](./adr/0010-wrap-up-keeps-a-standing-yes-to-push-behind-a-secret-scan.md) keeps the one standing yes to push, wrap-up's, behind a scan for token shapes, the mistake no undo fixes, session landings included. A plain `issue:remove` is free because it refuses unlanded work, while `issue:remove --force` asks, since the work it discards can't be brought back (#257).

### Keep the payload on disk and the summary in context

Whatever enters the context is paid for on every later turn. A full payload, printed once, rides along through unrelated work. Show a summary that is enough to decide the next step, and keep the complete record somewhere a ranged read can reach it, so the summary never hides needed detail.

_Instances:_ a chore dry run prints one rendered line per request, and `-- --json` is the escape hatch for when a line looks wrong (the framework's `docs/how-it-runs.md`, "The chore and its dry run"). `npm run app:probe` prints keys, counts and sheet titles, and writes the full response to `.probe/last.json` for a ranged `Read` (#53).

### Delegate the reading, not the judgment

A dispatched agent starts cold and sees only what it is handed, so it is good at finding things and poor at deciding what they mean. Send out work that reads a lot and returns a little. Keep the diagnosis, and any action that needs the operator's yes, in the session that holds the task context.

_Instances:_ dispatched agents report the command they would run rather than running a gate, and must return `file:line` with verbatim quotes ([`docs/agents/delegation.md`](./agents/delegation.md), `d6b8ae3`). `repo-explorer` runs on Sonnet with read-only tools, and it locates code without diagnosing (#53). A `ready-for-agent` ticket keeps the design forks and flush shapes with its writer, and the implementer carries them out: #80 left its flush and naming rules to be inferred, and #89 had to restate them (#91).

### Approval covers what was named, and nothing next to it

A yes is scoped to the specific thing the operator saw. A general go-ahead, or approval of a neighbouring step, is not consent to an action whose effects they didn't see named.

_Instances:_ [ADR 0008](./adr/0008-gate-agent-actions-by-what-they-cost-to-undo.md) makes a share ask on its own, naming who gets access and at what permission, even on a file whose writes are free. During design or grilling, nothing is written until the operator invokes the skill that files it: approving a design is not approving its publication (`5d5c77c`).

### Put each rule where it gets followed, and its reasoning one pointer away

What an agent loads without asking is paid for on every task, and a rule it has to go looking for is a rule it skips. So a behavior-changing rule is placed wherever it gets followed, even at the cost of repeating it, and the reasoning, examples and history are never auto-loaded: they sit exactly one pointer from the rule, behind the fixed sentence "Open a reasoning file only when you're changing the rule, or the rule's line doesn't decide your case". A rule goes on the highest rung it can reach: lint, then path-triggered (a nested `AGENTS.md`, a hook), then a router pointer, then prose. Lint needs no reader at all, and a path trigger reaches only the agents touching that folder. Hooks only reinforce, and no rule lives only in a hook, because more than one agent works this repo. A nested `AGENTS.md` is what Codex and Cursor read, and it is paired with a one-line `CLAUDE.md` importing it because Claude Code, with a root `CLAUDE.md` present, loads a subfolder's `CLAUDE.md` on demand but not its `AGENTS.md`. README.md is derived prose for people: routing agents through a 30 KB pitch cost more than the few facts they needed from it, so those facts moved to their homes and README mirrors them. The read-first gate denies rather than injecting config/docs/code-style.md: an injection would pay the whole file on every first edit, even when it is already in context, whereas a deny names one read and leaves the agent to take it once. It counts only a Read that covers the whole file, since a gate a five-line read unlocks is no gate.

A rules file holds only the rule: a rule line is the bolded rule plus at most a clause of scope or its one exception, and every example, instance, citation and why sits in the reasoning file. That convention replaced a 300-character cap on rule lines. The cap became a target: rules clustered just under it, padded with an example or a second clause to fill it, or squeezed to fit it, so it bought neither brevity nor clarity. Brevity and clarity are held together by the written convention and by review instead, because a number can measure only one of them. The size caps on AGENTS.md files failed the same way, so [ADR 0012](./adr/0012-replace-agents-md-size-caps-with-a-stated-cost-of-adding.md) replaced them with a stated cost, which is that every byte is paid on every turn and dilutes the rest, so the agent adding to the file weighs that itself ([`prose-files.md`](./agents/prose-files.md#what-an-addition-to-agentsmd-costs)). A lead is capped in bytes as well as lines, since a line count lets one long paragraph through, and a doc over 4 KB needs `##` headings, since a doc with none is one long lead read whole.

_Instances:_ the style doc was followed more consistently once it became one line per rule with the reasoning under `docs/code-style/` (`a7810dd`), and the same shape now holds packages/framework/docs/vocabulary.md; `src/`-only rules left the root AGENTS.md for `src/AGENTS.md`; the tier rule and the doc structure's limits moved to `npm run lint`; editing code without opening the style doc, the most common miss, got the gate (#108); the rule-line cap gave way to the rule-only convention, and the style doc's trailing examples moved to `docs/code-style/` (#110); [ADR 0012](./adr/0012-replace-agents-md-size-caps-with-a-stated-cost-of-adding.md) replaces the AGENTS.md size caps with a stated cost of adding, since a cap became a target.
