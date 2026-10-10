# Matt Pocock on deterministic loops vs `/implement-spec` (research for #198, map #197)

Researched 2026-10-10. Sources pinned to commits: `mattpocock/skills` @ `49dd158` (the same SHA this repo's `.claude/skills/upstream.json` is synced to), `mattpocock/sandcastle` @ `7a4e7f7`, `mattpocock/dictionary-of-ai-coding` @ `ed1ebed`.

## Summary

- Pocock's published position is short and explicit: `/implement-spec` puts **an agent** in charge of orchestration inside one harness session (no infrastructure, you can watch and steer), but "for work that is truly AFK, a deterministic loop (Sandcastle, a shell script, a CI job) is faster, cheaper, and more reliable, because no agent makes the orchestration decisions." [S1] There is no longer essay on it that I could find; the argument lives in that FAQ answer plus the failure reports beside it (a review→fix loop that ran ~4 hours, a stale blocked-by frontier, parallel implementers colliding). [S1]
- His code for the deterministic side is **Sandcastle** (`@ai-hero/sandcastle`): a TypeScript library where `run()` launches one headless agent step in a sandbox/worktree, returns commits, and can extract **schema-validated structured output**; control flow (loops, gates on `npm test`, implement→review sequencing, parallelism) is plain TypeScript. [S4][S5][S6] Its own repo runs GitHub-Actions "agent workflows" triggered by **labels** as a state machine, with an agent producing a JSON plan and a separate deterministic step applying every GitHub write. [S8][S9][S10]
- `loop-me` (in-progress): a grilling session whose only output is **workflow specs** for recurring "loops" in your life; its vocabulary (trigger, checkpoint, **push right**, **brief**) is the useful part. [S11]
- `chief-of-staff` (in-progress, added 2026-10-05): the opposite of a deterministic loop: one long-running agent session that does everything through background subagents, communicates via context pointers, and constantly improves the environment ("pit of success", "no workarounds"). [S12]
- `claude-handoff` (in-progress): this repo's `/handoff` plus one step: launch the handoff file as a fresh background agent with `claude --bg --name "<name>" -- "$(cat <file>)"`. [S13]
- Adopt directly: Sandcastle-style structured-output extraction (agent emits a validated JSON verdict, code routes it); the "agent plans, code applies effects" split; the `<promise>COMPLETE</promise>`/no-commits checks; bounded iteration caps; review-then-single-fix with no second broad review; `claude --bg` for launching steps. Borrow: label state machine for phone-driving, push-right/brief for the Halt message, Address/Decline/Defer triage. Does not fit: agent-as-orchestrator (`/implement-spec`, `chief-of-staff`), parallel worktree fan-out against this repo's live-spreadsheet gates and shared `packages/*` clones, Docker sandboxes as a requirement, Sandcastle's refusal of sub-issues.

## 1. The argument: deterministic loop vs `/implement-spec`

**Primary statement** (docs page for `implement-spec`, "Does this replace Sandcastle or an AFK script?") [S1, line 62-64]:

> No. ... `implement-spec` puts an agent in charge of orchestration inside one harness session, which needs no infrastructure and lets you watch and steer. For work that is truly AFK, a deterministic loop (Sandcastle, a shell script, a CI job) is faster, cheaper, and more reliable, because no agent makes the orchestration decisions.

What `/implement-spec` itself does [S2]: an orchestrating agent reads the spec's tickets as a **task graph** with a **frontier**; runs background **implementer subagents**, each in its own worktree on its own branch, each calling `tdd`, each merging the integration-branch tip into itself before reporting; a **merger subagent** lands each onto one **integration branch**; when all tickets are done, one `code-review` over the integration branch and one implementer subagent fixes everything raised; then resolve tickets / mark PR ready; clean worktrees. Communication through **context pointers**, not pasted summaries.

Failure modes he documents for agent orchestration (all from [S1]); each is an argument for putting that decision in code:

- **Unbounded review loop.** If `code-review` runs mid-run, unbuilt tickets read as failures and trigger more building and more review. Even at the end, the skill "doesn't yet say when to stop after that fix"; one user's five-ticket feature's "review and fix loop took roughly four hours". His advice: after the fix, "run focused checks for the fixed findings and stop." He also says to expect the first review to find real problems: "The run's output is a draft that the review completes." (line 48-50)
- **Stale frontier on GitHub.** Blocked-by counts drop only when a blocker *closes*, typically at the end of the run, so "Tell the orchestrator to track which tickets have merged into the integration branch itself and compute the frontier from that." (line 58-60)
- **Parallel collisions.** "Worktrees don't remove collisions; they postpone them to merge time." Fix: add a blocking edge between frontier tickets touching one shared file, or pin names in shared exploration notes. (line 54-56)
- **Worktree-skipped tests.** Gitignored fixtures/credentials are absent in a worktree, so a key test can silently skip and report green; run such tickets in the main checkout. [S1]
- `/implement` (single ticket) failure modes also relevant to a runner [S3]: it never closes the ticket or ticks boxes ("If nothing gets closed, nothing ever becomes visibly unblocked"); `code-review` sees only committed changes; a self-review is "biased toward its own solution", so running review "in a fresh session against a fixed point is a valid alternative"; a ticket over ~100-150K tokens is too big: "split it rather than raising the effort level."

**Earlier form of the argument: Ralph (AFK loops).** On aihero.dev he teaches the "Ralph" pattern: run the same prompt in a bash `for` loop, agent picks the next task from a PRD, commits, appends to `progress.txt`, and outputs `<promise>COMPLETE</promise>` which the script checks to exit. [S14][S15] Tips include: HITL (`ralph-once.sh`) before AFK; "always cap your iterations" (5-10 small, 30-50 large); feedback loops (types, tests, lint, pre-commit) gate commits; small steps; Docker sandbox. [S15] Note the contrast with the later Sandcastle position: in Ralph "the agent chooses the task, not you" [S15] (the loop is deterministic, task selection is not). The Ralph pattern's origin is credited to Geoffrey Huntley by third parties (non-primary, not verified).

**Dictionary framing** (his `dictionary-of-ai-coding`) [S16]: an **automated check** is deterministic (types, tests, lint); **automated review** is "Non-deterministic: it forms a judgement" and should be treated "as a filter that raises the floor before a human looks, not a gate that replaces one." **AFK** entry: the characteristic failure is "hours of finished, confident work built on a wrong call made in the first ten minutes"; so give input before (grilling, spec) and after ("the run ends in something reviewable — a PR, not changes already merged"); AFK "defers all of [human review] to the end".

## 2. Sandcastle: his code for deterministic loops

`@ai-hero/sandcastle`, "A TypeScript library for orchestrating AI coding agents in isolated sandboxes" [S4]:

- `run({ agent: claudeCode("<model>", { effort }), sandbox, promptFile | prompt, promptArgs, maxIterations, branchStrategy })` returns `{ iterations, commits, branch, ... }`. Agent providers include `claudeCode`, `codex`, `pi`, `cursor`, `opencode`, `copilot` (only the first three support session resume). Sandboxes: `docker`, `podman`, `vercel`, `noSandbox()`. [S4]
- `createSandbox()` keeps one warm sandbox for **multi-run implement-then-review** on one branch, and `sandbox.exec("npm test")` lets code gate the review step on a non-zero exit. [S4]
- Branch strategies `head` / `merge-to-head` / `branch` (named branch in a worktree). [S4]
- **Completion signal** `<promise>COMPLETE</promise>` (configurable, array allowed; matched signal returned as `result.completionSignal`), plus idle and completion timeouts. [S4]
- **Structured output**: `Output.object({ tag, schema })` with any Standard Schema validator (Zod etc.) extracts a typed payload from the agent's stdout; `maxRetries` resumes the session and feeds back the validation error. [S4]
- **Session resume / fork** and per-iteration usage reporting. [S4]
- `sandcastle init` templates: `simple-loop`, `sequential-reviewer` (implement then review per issue, stop when implement produces no commits), `parallel-planner`, `parallel-planner-with-review`. [S4][S6]

Example code in his repos:

- `src/templates/sequential-reviewer/main.mts` [S6]: `for` loop to `MAX_ITERATIONS`; per iteration a fresh named branch, implementer `maxIterations: 1` ("A higher value lets the agent drain the whole backlog onto this one branch ... which defeats the per-issue review"), `if (!implement.commits.length) break`, then a reviewer run on the same branch. Note: the implementer agent still picks the issue.
- `.sandcastle/run.ts` [S5]: Plan phase (an Opus **planner agent** emits a `<plan>` JSON of parallelizable issues), Execute+Review phase (max 4 parallel sandboxes, implement then review only if commits), Merge phase (one merger agent). Task selection is again an agent.
- `.factory/implement-task.ts` [S7]: an implement→review entry point spawned "once per task" by a "factory daemon" with env vars (`FACTORY_BRANCH`, `FACTORY_BASE`, task id/issue). The daemon itself lives in `~/repos/ai/software-factory` per `run-daemon.sh` [S7]; `github.com/mattpocock/software-factory` returns 404 (private or nonexistent) — **unknown**.
- `.sandcastle/agent-workflows/*` + `.github/workflows/agent-*.yml` (newest; batch explore landed 2026-10-07) [S8][S9][S10]:
  - Triggered by **labels**: `agent:implement` on an issue, `agent:review` / `agent:implement` on a PR, `agent:explore`. Jobs swap labels `agent:in-progress` → done, or `agent:blocked` on failure. [S9]
  - `agent-implement.yml` deterministically refuses an issue with sub-issues or with a parent ("this MVP only supports standalone issues"), refuses if a collaborator's PR already targets it, computes the branch name `agent/issue-<n>-<slug>` in shell, then runs `implement.ts`, which **fails if zero commits ahead of main**. The implement prompt says "Do not push ... Do not close the issue. Do not edit labels. Do not create or edit PRs." — the workflow does those. [S9][S8]
  - `review/prompt.md`: reviewer may commit improvements and triages human review threads as **Address** (change code and reply) / **Decline** (reply why) / **Defer** (no reply). Output is a schema-validated JSON (`summary`, `inlineComments`, `replies`), filtered in code against real diff lines and real comment ids before posting. [S8]
  - `shared/run-with-extraction.ts`: a **two-step produce→extract** pattern: run the agent normally, then resume the same session with a short extraction prompt whose completion signal is the closing output tag, validated with retries (default 2). [S8]
  - `explore/apply.ts`: "Deterministic effects step ... Validates the agent's whole plan before touching anything; on any problem it changes nothing ... The agent never runs in this job: it only ever sees a JSON plan, and every GitHub write goes through the fixed vocabulary in `planEffects`." The explore verdicts are `easy-call` / `needs-a-human` / `blocked`, and `needs-a-human` routes to a `ready-for-human` label (commit 2026-10-08). [S10]

## 3. The three in-progress skills

The `in-progress` bucket is "Beta ... excluded from the plugin ... they get no docs pages, and they can change or disappear without warning." [S17] So there are no docs pages to cite beyond the SKILL.md files and commit history.

### `loop-me` [S11]

What it does: a stateful `/grilling` session "whose only output is workflow specs". A **loop** is a recurring pattern in the user's life; a **workflow** is the spec of one loop, stored in `workflows/*.md`, with `NOTES.md` for the user's tools and terms. Vocabulary: **Trigger** (event or schedule; "Event-triggering is usually the more efficient"), **Checkpoint** (human-in-the-loop point), **Push right** ("defer the checkpoint as far as it will go. Do maximal work before involving the human, so they are asked once, late, with everything prepared"), **Brief** ("a tight, decision-ready summary (what was produced, why, and a link down to the asset itself), never the raw output"). "Mandate nothing structural": no AI, checkpoint or schedule unless grilling shows it. Done = "an implementer agent could build it without asking a single question." Moved into in-progress 2026-06-24. [S11]

- Adopt directly: nothing as a skill; this repo already has `/grilling` and a spec flow for the runner.
- Borrow: **push right** and **brief** as the design rule for the runner's Halt: the only human checkpoint, reached late, presenting a decision-ready brief with links (issue, branch, finding) readable on a phone, never raw review output. **Event trigger** over polling for kicking the runner.
- Does not fit: it designs life workflows in a separate `workflows/` workspace, not code-spec implementation.

### `chief-of-staff` [S12]

What it does: "Pursue a long-running goal in a single session by co-ordinating subagents." The main session is the DRI, thinks tactically and strategically ("how do I modify the environment to improve the outcomes of the _next_ task?"), suggests recurring schedules, does "All work ... in subagents. Protect your context window", uses background agents to stay in dialogue, communicates via **context pointers**, and treats every message as a chance to improve the environment: "pit of success" (constrained APIs, lint rules, CODING_STANDARDS.md), data sources (logs, test DBs, browser), and a **"no workarounds"** rule. Created 2026-10-05, edited through 2026-10-06. [S12]

- Adopt directly: nothing; it is an agent-orchestrator, the thing #197 is replacing with code.
- Borrow: the strategic track maps onto this repo's model-fit outcome log and `/retro`-style environment fixes; a runner can record per-ticket outcomes so a human (or a later step) improves the environment between runs. "Mechanical violation → deterministic check" is the same idea in his `retro` skill [S18].
- Does not fit: one long-lived session accruing "tribal knowledge" conflicts with this repo's fresh-session-per-ticket and handoff discipline (`docs/agents/planning.md`), and with control flow in code.

### `claude-handoff` [S13]

What it does: same text as `/handoff` (which this repo vendors, `.claude/skills/handoff/SKILL.md`), plus: save the summary to the OS temp dir, then `claude --bg --name "<descriptive name>" -- "$(cat <summary file>)"` ("Passing the file keeps the shell from running backticks or expanding `$`"); it returns immediately and the user manages it with `claude agents`. `--name` is mandatory. Redact secrets "since the summary becomes the agent's prompt." Added 2026-07-02; launch wording tightened 2026-10-06. [S13]

- Adopt directly: the launch mechanics (`claude --bg --name`, prompt from a file, not interpolated) for any runner step that hands an over-budget ticket's exploration handoff to a fresh implementer, and for the wrap-up step (this repo's wrap-up is already "a prompt for a fresh agent", `docs/agents/git-workflow.md` Landing a spec). Whether `claude --bg` or `claude -p` suits a code-driven runner better is an open question: `-p` returns output to the caller; `--bg` detaches.
- Borrow: the agent-written handoff as the payload of a code-launched step.
- Does not fit: as a skill it is still agent-initiated; in the runner, code decides when to hand off.

## 4. Fit to this repo's planned runner

Repo process recap (local files): `/implement` (vendored from him, identical in substance) commits to the current branch then runs `/code-review` against `master`; `/code-review` reports Standards and Spec axes side by side without reranking; `/to-tickets` publishes tickets with blocking edges as native GitHub links; wrap-up is a fenced prompt for a fresh agent with merge, outcome-log row, push, branch deletion, close and parent check (`docs/agents/git-workflow.md`); model fit picks one of six pairs including Grok 4.7 low via Cursor (`docs/agents/planning.md#model-fit`).

| Item | Adopt directly | Borrow as inspiration | Does not fit |
| --- | --- | --- | --- |
| Deterministic-loop argument [S1] | Put frontier, model pick, step launch, routing in code; agent steps only produce artifacts. | — | — |
| Frontier from merged state [S1] | Compute "done" from what the runner merged/closed, not tracker counts mid-run. | — | — |
| One review, one fix, focused re-check, stop [S1] | Bound the review→fix cycle in code (max N; re-check only fixed findings). | — | Open-ended "review until clean". |
| Structured output + extraction [S4][S8] | Review/triage step emits a schema-validated verdict (Dismiss/Fix/Defer/Halt) that code routes. | — | — |
| Agent plans, code applies effects [S10] | Agent steps never `gh` write; code labels/comments/closes, validates the whole plan first, changes nothing on invalid output. | — | — |
| Zero-commit and completion checks [S4][S8] | Fail the step when no commits ahead of base or no completion signal. | — | — |
| Iteration caps [S15] | Hard caps per ticket and per run. | — | — |
| Label state machine via Actions [S9] | — | Labels as runner states are settable from the GitHub mobile app: one way to "drive from a phone". | Running in GitHub Actions: this repo's checks need the `clasp` credential gates and local `packages/*` clones; the runner is local. |
| Address/Decline/Defer [S8] | — | Close to Fix/Dismiss/Defer; add Halt. | — |
| Sandcastle library itself [S4] | — | Possible dependency (supports `claudeCode` with effort, `cursor` for Grok); worth a prototype ticket. | Docker sandbox as a default (bind-mount of shared `packages/*` clones; the live-spreadsheet `app:*` gates must stay out of reach regardless of sandbox). |
| Parallel worktrees (`/implement-spec`, `parallel-planner`) [S2][S5] | — | — | Parallel implementers: shared `packages/*` clones and nested repos ("a checkout can move under you"), and his own collision report. Sequential first. |
| Agent picks the task (Ralph, templates) [S5][S6][S15] | — | — | Runner picks from the blocking graph in code. |
| Refuse sub-issues [S9] | — | Deterministic preflight refusals (already-open PR, wrong shape). | His MVP refuses any issue with a parent; this repo's tickets are sub-issues of a spec. |
| `loop-me` push right / brief [S11] | — | Halt message = one late brief with links. | The skill itself. |
| `chief-of-staff` [S12] | — | Outcome logging feeds environment fixes between runs. | Agent-as-orchestrator. |
| `claude-handoff` [S13] | `claude --bg --name` launch from a prompt file. | Handoff file as a step payload. | Agent-initiated hand-off. |
| Fresh-session review [S3] | Review as a separate headless step, not the implementer reviewing itself. | — | — |

Other relevant publications: his `triage` skill and labels (`ready-for-agent`, and a noted gap: no terminal state for "implemented, awaiting verification ... an AFK runner can queue finished tickets again") [S19]; `to-spec` docs warn AFK agents polling `ready-for-agent` will try to build the parent spec, so exclude it [S20]; `retro` turns mechanical review findings into lint/CI checks [S18].

## Unknowns

- No long-form essay, newsletter or video by Pocock specifically on "deterministic loops vs agent orchestration" was found; the claim rests on one docs FAQ answer [S1] plus code. Searches of aihero.dev, YouTube and X surfaced no primary source beyond those (web search, 2026-10-10).
- The "factory daemon" / `software-factory` repo referenced in Sandcastle's `.factory/` is not public (404). Its scheduling logic is unknown.
- Whether he has published a deterministic version of the triage step for **review findings** (as opposed to issue explore verdicts) is unknown; the closest is the review prompt's Address/Decline/Defer and explore's `easy-call`/`needs-a-human`/`blocked`.
- Whether Sandcastle's `cursor` provider supports the Grok 4.7 low model this repo uses, and its effort option, is unverified.
- The in-progress skills may change or vanish without warning [S17].

## Sources

- [S1] implement-spec docs: https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/docs/engineering/implement-spec.md (also published at https://aihero.dev/skills-implement-spec per the repo's links; site rendering not checked)
- [S2] implement-spec skill: https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/implement-spec/SKILL.md
- [S3] implement docs: https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/docs/engineering/implement.md
- [S4] Sandcastle README: https://github.com/mattpocock/sandcastle/blob/7a4e7f7d93056600d979d79a090256feddf653ea/README.md
- [S5] Sandcastle run.ts: https://github.com/mattpocock/sandcastle/blob/7a4e7f7d93056600d979d79a090256feddf653ea/.sandcastle/run.ts
- [S6] sequential-reviewer template: https://github.com/mattpocock/sandcastle/blob/7a4e7f7d93056600d979d79a090256feddf653ea/src/templates/sequential-reviewer/main.mts
- [S7] factory entry point: https://github.com/mattpocock/sandcastle/blob/7a4e7f7d93056600d979d79a090256feddf653ea/.factory/implement-task.ts and `.factory/run-daemon.sh`
- [S8] agent workflows (implement, review, shared/run-with-extraction): https://github.com/mattpocock/sandcastle/tree/7a4e7f7d93056600d979d79a090256feddf653ea/.sandcastle/agent-workflows
- [S9] Actions workflows: https://github.com/mattpocock/sandcastle/tree/7a4e7f7d93056600d979d79a090256feddf653ea/.github/workflows (`agent-implement.yml`, `agent-review.yml`)
- [S10] explore apply step: https://github.com/mattpocock/sandcastle/blob/7a4e7f7d93056600d979d79a090256feddf653ea/.sandcastle/agent-workflows/explore/apply.ts and `explore/prompt.md`
- [S11] loop-me: https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/in-progress/loop-me/SKILL.md
- [S12] chief-of-staff: https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/in-progress/chief-of-staff/SKILL.md (history: commits e47c149, 2b47ffc, 6fd9479)
- [S13] claude-handoff: https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/in-progress/claude-handoff/SKILL.md
- [S14] Getting started with Ralph: https://www.aihero.dev/getting-started-with-ralph
- [S15] Tips for AI coding with Ralph Wiggum: https://www.aihero.dev/tips-for-ai-coding-with-ralph-wiggum
- [S16] Dictionary of AI coding (AFK, Automated check, Automated review): https://github.com/mattpocock/dictionary-of-ai-coding/blob/ed1ebed3975cba04ed5e74c6ca73659274beb754/README.md
- [S17] in-progress README: https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/in-progress/README.md
- [S18] retro skill: https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/retro/SKILL.md
- [S19] triage docs: https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/docs/engineering/triage.md
- [S20] to-spec docs: https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/docs/engineering/to-spec.md
- Non-primary, not relied on: Ralph origin credit to Geoffrey Huntley (https://kingy.ai/news/what-is-a-ralph-loop-how-a-bash-one-liner-became-an-ai-coding-pattern/).
