# Prior art for agent loops and review triage (#199, map #197)

Researched 2026-10-10. Every claim cites the page it came from. **[non-primary]** marks a source that is not the owner of the fact. Inferences of mine are marked *(inference)*.

## Summary

- **Every documented loop keeps state in files and git, not in the context window.** Ralph uses a spec folder plus `fix_plan.md`, Anthropic's harness uses a JSON feature list plus `claude-progress.txt`, and snarktank/ralph uses `prd.json` plus `progress.txt`. Each starts a fresh context per item and does **one item per loop**. That matches our "control flow in code, agents do bounded steps."
- **Stopping for a human is the least developed part of the prior art.** Ralph, the Anthropic harness posts and the C-compiler run all aim at *no* human in the loop. Stops come from caps (iterations, turns, budget), stuck detectors (OpenHands: same action and observation 4 times, same error 3 times; frankbria: 3 loops with no file change) or a completion string. Only `/goal` has an explicit **"impossible"** verdict. Only dynamic workflows state the rule we need: **no mid-run user input**, so a sign-off point means ending the run.
- **The SDK gives our runner deterministic hooks for everything it needs to stop on.** It has typed result subtypes (`error_max_turns`, `error_max_budget_usd`, `error_during_execution`, `error_max_structured_output_retries`), schema-validated structured output (a triage verdict can be an enum) and `getContextUsage()`, which returns `totalTokens`, so the ~150K handoff rule can be measured by the runner instead of guessed by the agent.
- **Review triage prior art splits "severity" from "disposition."** Conventional Comments, Google, Netlify and Claude Code Review all separate *how bad* a finding is from *what happens to it*. Classes our four lack:
  - **Pre-existing** (Claude Code Review, SARIF `baselineState`, the code-review plugin's false-positive list)
  - **Unverified / needs evidence** (SARIF `kind: open`, the `review` kind and Conventional `question:`)
  - **Future action required vs. mere consideration** (Netlify's pebble vs. sand/dust; GitHub's `won't fix` vs. `false positive` vs. `mitigated`)
  - **Doc drift** (Claude Code Review flags a CLAUDE.md made stale by the diff)
- **Recommendation headline:** keep the four dispositions, and give each finding a structured verdict. That verdict should carry a dismissal *reason* enum, a `pre_existing` flag and an `evidence` field, so a finding nobody can verify goes to Defer instead of Fix. The runner, not the model, enforces stop and retry caps, and Halt does not resume the same run: the runner ends it and a new run starts after the human answers.

## 1. Loops that work through a ticket list

### 1.1 Ralph (Geoffrey Huntley, primary)

Source: Huntley, "Ralph Wiggum as a 'software engineer'", 14 July 2025, https://ghuntley.com/ralph/

- **The loop.** "In its purest form, Ralph is a Bash loop": `while :; do cat PROMPT.md | claude-code ; done`.
- **Inputs.** Specs are written up front, "one per file". `fix_plan.md` is the task list. `AGENT.md` holds build and run notes that Ralph updates. The specs and plan are loaded every time: "deterministically allocate the stack the same way every loop."
- **One item per loop.** "One item per loop. I need to repeat myself here—one item per loop." Ralph himself picks "the most important thing", so the loop does not pick the item.
- **Backpressure.** Ralph runs the tests for the unit he changed, and type checkers and static analysers are wired in. Passing tests lead to commit, push and a git tag.
- **Failure handling is prompt tuning.** "Each time Ralph does something bad, Ralph gets tuned - like a guitar". Bugs Ralph finds go back into `fix_plan.md`.
- **Stopping and the human.** Ralph stops when he "run[s] out of things to do in the TODO list. Or, it goes completely off track." The human then decides between "a `git reset --hard`" and writing rescue prompts. The plan is disposable: "I have deleted the TODO list multiple times... I throw it out often."
- **Context.** "you only have approximately 170k of context window to work with". The main context should act as a scheduler, with subagents doing expensive work. The example prompt allows many subagents for search but only one for build and test.
- A third-party summary reports Huntley saying the real Ralph is planning-heavy, not the Stop-hook plugin. **[non-primary]**, https://github.com/coleam00/cole-medin-knowledge-base/blob/main/entities/people/geoffrey-huntley.md (unverified against Huntley's own words).

### 1.2 Anthropic's `ralph-wiggum` Claude Code plugin (primary for the plugin)

Source: https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum

- **Mechanism.** The plugin "implements Ralph using a **Stop hook** that intercepts Claude's exit attempts". "The loop happens **inside your current session**". "The prompt never changes between iterations".
- **Options.** `--max-iterations` (default unlimited) and `--completion-promise`, which "uses exact string matching, so you cannot use it for multiple completion conditions (like "SUCCESS" vs "BLOCKED")". It also says: "Always rely on `--max-iterations` as your primary safety mechanism."
- **Stated non-fits.** "Tasks requiring human judgment or design decisions", and "Tasks with unclear success criteria".
- *(inference)* Because the loop runs in one session, context builds up across iterations, unlike Huntley's fresh process per iteration. One completion string cannot tell "done" apart from "blocked", and our Halt needs exactly that distinction.

### 1.3 Third-party Ralph runners (primary for their own behaviour)

- **snarktank/ralph**, https://github.com/snarktank/ralph
  - Each iteration starts a fresh AI instance.
  - It picks "the highest priority story where `passes: false`" from `prd.json`.
  - It runs typecheck and tests, and commits only on pass.
  - It appends learnings to `progress.txt` and updates `AGENTS.md`.
  - It exits on `<promise>COMPLETE</promise>` or the iteration cap ("Default is 10 iterations").
- **frankbria/ralph-claude-code**, https://github.com/frankbria/ralph-claude-code
  - It has a **circuit breaker** with three triggers: `CB_NO_PROGRESS_THRESHOLD=3` ("3 loops with no file changes"), `CB_SAME_ERROR_THRESHOLD=5` and `CB_OUTPUT_DECLINE_THRESHOLD=70`. The circuit goes OPEN, then HALF_OPEN after a 30-minute cooldown, then CLOSED.
  - Exit needs **both** natural-language completion signals (≥2) **and** an explicit `EXIT_SIGNAL: true`.
  - It "halts when Claude Code is denied permission for commands".

### 1.4 Anthropic engineering on long-running harnesses (primary)

**"Building effective agents"**, 19 Dec 2024, https://www.anthropic.com/engineering/building-effective-agents

- It defines workflows as "LLMs and tools are orchestrated through predefined code paths", which is our runner, and agents as LLMs that "dynamically direct their own processes".
- Prompt chaining puts programmatic gates between steps. Evaluator-optimizer fits "when evaluation criteria are clear".
- Agents can "pause for human feedback at checkpoints or when encountering blockers". It recommends stopping conditions such as a maximum number of iterations, and getting "ground truth" from the environment at each step.

**"Effective harnesses for long-running agents"** (Justin Young), 26 Nov 2025, https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents

- **Two failure modes:** doing too much at once and running out of context mid-feature, and later sessions declaring the job done early.
- **Fixes:**
  - An initializer session writes a JSON feature list in which every item starts failing.
  - Coding sessions may only flip `passes`: "It is unacceptable to remove or edit tests". JSON was chosen because the model is less likely to overwrite it than Markdown.
  - Coding sessions do one feature per session, which the post calls "critical", and leave a "clean state" fit to merge.
  - Each session gets up to speed by reading git log and the progress file, then running a basic end-to-end test before new work.
- **Handoff.** It names no context threshold. Handoff is the progress file plus the feature list plus git. Compaction alone "doesn't always pass perfectly clear instructions to the next agent".
- The post describes no human checkpoints in the loop.

**"Harness design for long-running application development"** (Prithvi Rajasekaran), 24 Mar 2026, https://www.anthropic.com/engineering/harness-design-long-running-apps

- **Roles.** A planner writes the spec, a generator works in sprints and self-checks, and an evaluator uses Playwright to grade.
- **Sprint contract.** Before coding, the generator proposes what it will build and how it will be verified, and "the two iterated until they agreed".
- **Self-evaluation is lenient.** Out of the box Claude was "a poor QA agent" that would find real issues and then "talk itself into" approving the work. A separate evaluator was "far more tractable" to tune, using its logs and few-shot examples.
- **Hard thresholds.** "Each criterion had a hard threshold, and if any one fell below it, the sprint failed."
- **"Context anxiety".** Sonnet 4.5 needed context *resets* with a structured handoff. With Opus 4.5 the resets were dropped. With Opus 4.6 sprints and per-sprint evaluation were dropped for one final evaluator pass.
- **What was kept.** The planner, because without it the generator under-scoped. The evaluator, which is worth its cost only when the task is beyond what the model does reliably alone.
- No retry cap is described.

**"Building a C compiler with a team of parallel Claudes"** (Nicholas Carlini), 5 Feb 2026, https://www.anthropic.com/engineering/building-c-compiler

- **Harness.** A `while true` bash loop runs one `claude -p` per session and logs per commit. Agents lock tasks by writing files to `current_tasks/`, and git conflicts force a second claimant to pick another task.
- **Test harness design matters:**
  - Keep output short and write details to log files, to avoid "context window pollution".
  - Put `ERROR` where grep can find it.
  - Offer `--fast` sampling, because "Claude can't tell time".
- When stuck, agents keep "a running doc of failed approaches". "New features and bugfixes frequently broke existing functionality", which led to CI.
- No stopping criteria: "The loop runs forever." Warning: "it is easy to see tests pass and assume the job is done, when this is rarely the case."

**"Effective context engineering for AI agents"**, 29 Sep 2025, https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents

- Compaction keeps "architectural decisions, unresolved bugs, and implementation details". Tool-result clearing is the "lightest touch" form.
- Structured notes such as NOTES.md and to-dos persist outside the window.
- Subagents return "a condensed, distilled summary of its work (often 1,000-2,000 tokens)".

**"How we built our multi-agent research system"**, 13 Jun 2025, https://www.anthropic.com/engineering/multi-agent-research-system

- "minor system failures can be catastrophic for agents". They "resume from where the agent was when the errors occurred" and pair the model with "deterministic safeguards like retry logic and regular checkpoints".
- Near context limits, agents "spawn fresh subagents with clean contexts while maintaining continuity through careful handoffs".

**"Loop engineering: getting started with loops"** (de Oliveira, Segner), 30 Jun 2026, https://claude.com/blog/getting-started-with-loops

- It sorts loops into turn-based, goal-based (`/goal`), time-based and proactive.
- It prefers quantitative checks: "The more quantitative the checks are, the easier it is for Claude to self-verify." It recommends a second agent with fresh context for review.
- When a run falls short, encode the fix into the system rather than patching the one output.

### 1.5 Claude Agent SDK and Claude Code primitives (primary docs)

**Agent loop**, https://code.claude.com/docs/en/agent-sdk/agent-loop

- `max_turns`/`maxTurns` counts tool-use turns. `max_budget_usd`/`maxBudgetUsd` covers subagent spend too, and can overshoot by one response.
- Result subtypes are `success`, `error_max_turns`, `error_max_budget_usd`, `error_during_execution` and `error_max_structured_output_retries`. All of them carry `total_cost_usd`, `usage`, `num_turns` and `session_id`. `stop_reason` can be `refusal`.
- A single-shot `query()` raises after yielding an error result.
- Auto-compaction emits a `compact_boundary` message, and a `PreCompact` hook can archive the transcript first. The docs warn that "specific instructions from early in the conversation may not be preserved", so persistent rules belong in CLAUDE.md.
- Sessions can be resumed or forked by `session_id`.

**Structured outputs**, https://code.claude.com/docs/en/agent-sdk/structured-outputs

- `outputFormat: {type: "json_schema", schema}` takes JSON Schema draft-07 and supports `enum`. The SDK "validates the output against it, re-prompting on mismatch".
- Treat `success` without `structured_output` as a failure.

**TypeScript reference**, https://code.claude.com/docs/en/agent-sdk/typescript

- `getContextUsage()` returns `totalTokens`, `maxTokens`, `percentage` and `autoCompactThreshold`, the same data `/context` shows.
- A `PreToolUse` hook returning `permissionDecision: "defer"` ends the run with `stop_reason: "tool_deferred"` and the pending tool call, which can be resumed with the same `session_id`.

**`/goal`**, https://code.claude.com/docs/en/goal.md

- It is "a wrapper around a session-scoped prompt-based Stop hook". After each turn a small fast model returns one of three verdicts: **Not yet met**, **Met** or **Impossible**.
- If there is no tool use for several turns, it stops and returns control to the user.
- Errors the user has to fix clear the goal: auth, credit, context overflow that compaction could not clear, and an unavailable model. Transient errors get up to three automatic retries, then a pause.
- The evaluator "does not call tools", so it judges only what is in the transcript.

**Dynamic workflows**, https://code.claude.com/docs/en/workflows.md

- "A workflow moves the plan into code". `agent()` takes an optional `schema`, and failed validation is retried 5 times (`MAX_STRUCTURED_OUTPUT_RETRIES`).
- A stalled agent restarts from the same prompt, at most five times. "Files the stalled attempt already changed stay changed".
- **"No mid-run user input... For sign-off between stages, run each stage as its own workflow."**
- Resume replays saved results until the first agent whose prompt differs. A failed agent reruns along with every agent started after it.
- `Date.now()`/`Math.random()` throw so that replays stay deterministic. There is a 1,000-agent cap.

**Claude Code Review**, https://code.claude.com/docs/en/code-review.md. See §2. It also documents `/code-review --fix`, which marks findings "fixed, skipped, or no change needed".

### 1.6 Other open-source orchestrators (primary source code and docs)

- **OpenHands SDK `StuckDetector`.**
  - Source: https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-sdk/openhands/sdk/conversation/stuck_detector.py, with thresholds in `.../conversation/types.py`.
  - Five scenarios: repeating action and observation (default 4), repeating action and error (3), agent monologue (3), alternating pattern (6), and a context-window error loop.
  - Before declaring the agent stuck, it nudges once: "You've called `X` with the same arguments 3 times in a row and gotten the same error each time... try a different approach."
- **SWE-agent.**
  - Source: https://github.com/SWE-agent/SWE-agent/blob/main/sweagent/agent/agents.py
  - Typed exit statuses include `exit_context`, `exit_cost`, `exit_format`, `exit_forfeit`, `exit_api`, `exit_command_timeout`, `exit_total_execution_time` and `exit_error`.
  - Format and blocked-action errors are requeried up to `max_requeries = 3`. On fatal exits it "autosubmits", taking the current diff as the result.
  - A `RetryAgentConfig` runs multiple attempts under a retry loop.
- **Aider.** Source: https://github.com/Aider-AI/aider/blob/main/aider/coders/base_coder.py. The lint/test reflection loop is capped at `max_reflections = 3`, with the warning "Only 3 reflections allowed, stopping."
- **LangGraph `interrupt()`.** Source: https://docs.langchain.com/oss/python/langgraph/interrupts. It pauses for outside input, needs a checkpointer and resumes with `Command(resume=...)`. "The node restarts from the beginning of the node where the interrupt was called", and side effects before it "must be idempotent".

### 1.7 Comparison: stop, retry, handoff

| Source | Who picks the next item | Stop for human | Retry / stuck rule | Context handoff |
| --- | --- | --- | --- | --- |
| Ralph (Huntley) | Agent ("most important thing") | Human watches; list empty or off track | Prompt tuning; `git reset --hard` | Fresh process per loop; specs + plan reloaded |
| ralph-wiggum plugin | Agent | `--max-iterations`, single promise string | none built in | Same session (no reset) |
| snarktank/ralph | Agent, from `prd.json` priority | Iteration cap (10) | Commit only on green | Fresh instance; `progress.txt` |
| frankbria | Agent | Circuit breaker opens; permission denial | 3 no-change / 5 same-error loops | Session kept 24h |
| Anthropic harness (Nov 2025) | Agent, from JSON list | none described | Revert via git | Fresh session; progress file + git |
| Anthropic harness (Mar 2026) | Planner/contract | none described | Evaluator hard thresholds fail the sprint | Resets, later dropped |
| C compiler | Agent claims a lock file | none ("runs forever") | CI; failed-approaches doc | Fresh `claude -p` per session |
| `/goal` | Agent | **Impossible** verdict; no-progress stop | 3 auto-retries on transient errors | Compaction |
| Workflows | **Script** | Not mid-run; end the run | 5 stall restarts, 5 schema retries | Script variables, not context |
| OpenHands | Agent | is_stuck | 4 / 3 / 3 / 6 thresholds, one nudge | n/a |
| SWE-agent | Agent | Typed exits | 3 requeries; autosubmit | `exit_context` |

## 2. Review-finding triage prior art

### 2.1 Taxonomies (primary)

- **Conventional Comments**, https://conventionalcomments.org/
  - Labels: `praise`, `nitpick`, `suggestion`, `issue`, `todo` ("small, trivial, but necessary"), `question` ("a potential concern but are not quite sure if it's relevant"), `thought`, `chore` ("must be done before the subject can be 'officially' accepted"), `note`, `typo`, `polish`, `quibble`.
  - Decorations: `(blocking)`, `(non-blocking)` and `(if-minor)`, which means resolve it "only if the changes end up being minor or trivial". **Label (kind) and decoration (blocking-ness) are separate axes.**
- **Google eng-practices**, https://google.github.io/eng-practices/review/reviewer/comments.html
  - `Nit:` means "Technically you should do it, but it won't hugely impact things".
  - `Optional`/`Consider` means not strictly required.
  - `FYI` means "I don't expect you to do this in this CL" but worth thinking about for the future.
- **Netlify Feedback Ladders**, 5 Mar 2020, https://www.netlify.com/blog/2020/03/05/feedback-ladders-how-we-encode-code-reviews-at-netlify/
  - Mountain: "blocks all related work, and requires immediate action".
  - Boulder: blocks approval, "does not necessarily require immediate action".
  - Pebble: "not required for the MVP... but it does require future action".
  - Sand: non-blocking, acted on if another team member concurs.
  - Dust: "take it or leave it".
- **Claude Code Review**, https://code.claude.com/docs/en/code-review.md
  - Severity: 🔴 **Important** ("A bug that should be fixed before merging"), 🟡 **Nit** ("worth fixing but not blocking") and 🟣 **Pre-existing** ("exists in the codebase but was not introduced by this PR").
  - A verification step "checks candidates against actual code behavior to filter out false positives". New CLAUDE.md violations are nits, and a diff that makes CLAUDE.md outdated is flagged too.
  - REVIEW.md can cap nits ("report at most five nits"), set a "verification bar" ("behavior claims need a `file:line` citation") and set **"re-review convergence"** ("after the first review, suppress new nits and post Important findings only" so a fix doesn't reach "round seven on style alone").
- **Anthropic `code-review` plugin**, https://github.com/anthropics/claude-code/tree/main/plugins/code-review
  - The README describes 0–100 confidence scoring and filtering below **80**.
  - The current `commands/code-review.md` instead launches a validation subagent per bug finding and drops anything not validated. Its flag list is: won't compile, "definitely produce wrong results", and "Clear, unambiguous CLAUDE.md violations where you can quote the exact rule". Its do-not-flag list: "Pre-existing issues", "Pedantic nitpicks", "Issues that a linter will catch", "General code quality concerns... unless explicitly required in CLAUDE.md", "explicitly silenced in the code".
  - *(The README and command file disagree; the command file is what runs.)*
- **GitHub code scanning**, https://docs.github.com/en/rest/code-scanning/code-scanning. `dismissed_reason` is one of `false positive`, `won't fix`, `used in tests` or `mitigated`, plus a ≤280-char `dismissed_comment` kept for audit.
- **SARIF 2.1.0 (OASIS)**, https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/sarif-v2.1.0-errata01-os-complete.html. It has three orthogonal fields:
  - `kind`: `fail`, `pass`, `open` ("insufficient information to decide whether a problem exists"), `review` ("requires review by a human user to decide"), `informational` or `notApplicable`.
  - `level`: `error`, `warning` or `note`.
  - `baselineState`: `new`, `unchanged`, `updated` or `absent`. Suppression `status` is `accepted`, `underReview` or `rejected`.
- **Mäntylä & Lassenius**, "What Types of Defects Are Really Discovered in Code Reviews?", IEEE TSE 35(3), 2009, doi:10.1109/TSE.2008.71.
  - It splits review defects into *evolvability* and *functional*. Secondary sources say most review findings are evolvability, around 60–75%. **[non-primary]**, https://en.wikipedia.org/wiki/Code_review. Not verified against the paper.

### 2.2 How this maps onto Dismiss / Fix / Defer / Halt

| Prior-art class | Closest of our four | Gap it shows |
| --- | --- | --- |
| False positive (GitHub, plugin, Code Review verification) | Dismiss | Dismiss lumps "not real" with "a later ticket covers it" |
| `won't fix` / `mitigated` / `used in tests` (GitHub) | Dismiss | Accepted deviation needs a recorded reason |
| Pre-existing (Code Review, SARIF `unchanged`, plugin) | none | Not this diff's fault, but may be real: neither Dismiss nor Fix |
| `open` / `review` (SARIF), `question:` (Conventional) | Defer? | "Can't tell if it's real" differs from "real but a judgement call" |
| Important / boulder / `(blocking)` | Fix or Halt | Ours splits blocking by *clear-cut vs. judgement*, which is the right extra axis |
| Nit / `if-minor` / dust | Fix or Dismiss | Volume: needs a cap or a rule |
| Pebble ("requires future action") / FYI | Defer | Future work that should become a ticket, not a human decision |
| Sand ("if another member concurs") | Defer | Judgement call for the human; fits our Defer |
| Mountain ("blocks all related work") | Halt | Matches |
| Doc drift (Code Review) | Fix | Worth naming as a Fix trigger |
| Linter- or tsc-enforced | Dismiss | Prior art drops these before triage |

## 3. Unknowns

- No primary source documents a review-triage step **inside** an implementation loop that sorts findings into fix-now, ask-the-human and stop. Everything found is either PR review for a human, or an evaluator that passes or fails the whole sprint.
- None of the Anthropic harness posts give a token threshold for handoff, or retry caps for failing sprints.
- How the `ralph-wiggum` plugin detects the promise beyond "exact string matching" (the hook script was not read).
- Whether the code-review plugin's README (confidence 80) or command file (validation subagents) reflects current intent. The command file is what runs.
- Mäntylä & Lassenius percentages (secondary only). Bacchelli & Bird 2013 (Microsoft) review-outcome categories were not retrieved; the PDF would not decode.
- Huntley's view of the Stop-hook plugin is reported only second-hand.

## 4. Recommendations for the #197 runner (these are recommendations, not findings)

1. **Make triage a structured-output step with two axes.** The schema should carry:
   - `disposition`: Dismiss, Fix, Defer or Halt
   - `dismiss_reason`: `false_positive`, `covered_by_ticket` (ticket ref required), `accepted_deviation` (comment required) or `tooling_enforced`
   - `pre_existing`: boolean
   - `evidence`: a `file:line` plus the quoted rule or spec line

   Sources: GitHub's reasons, SARIF's separate axes, and the plugin's "quote the exact rule". Using the SDK's `outputFormat` enum makes the runner's branching deterministic.
2. **Add an evidence gate before Fix.** A Fix must quote the spec, ticket or style line it breaks, the way the plugin and the REVIEW.md "verification bar" require. With no quote, it is not clear-cut and goes to Defer. This matters because our Standards axis labels every Fowler smell "always a judgement call" (`.claude/skills/code-review/SKILL.md`), so smells should never auto-Fix.
3. **Route pre-existing findings** to Defer with `pre_existing: true` (or to a new-ticket list), never to Fix in-loop. That keeps the diff in scope, as Code Review and the plugin do.
4. **Split Defer into "needs a decision" and "needs a ticket"** (Netlify's sand vs. pebble, Google's FYI). The end-of-spec list stays short, and ticket-shaped items can be filed in one batch.
5. **Use re-review convergence.** After the first review of a ticket, the runner keeps only blocking findings, Halt-class or a Fix with evidence, and caps the fix-and-review rounds, for example at 2–3. The caps in the prior art are Aider's 3 reflections, SWE-agent's 3 requeries and OpenHands' one nudge before declaring the agent stuck. When the cap is hit, the finding becomes Defer, or Halt if it blocks a later ticket.
6. **Stops are runner rules, not agent judgement.** Set `maxTurns` and `maxBudgetUsd` on every step and branch on the result `subtype`. Add a no-progress breaker: N steps with no diff (frankbria uses 3), or the same failing test or tsc error twice. Treat `success` without `structured_output` as a failure.
7. **Halt ends the run; it does not wait inside it.** Workflows have "no mid-run user input", and LangGraph's resume reruns the node. So on Halt, finish the other findings, commit, write the handoff and exit. The next spec run starts fresh from git plus the ticket list, which needs no resume machinery.
8. **The runner measures the ~150K handoff.** Call `getContextUsage()` after each step and use `totalTokens` to decide whether Fix batches go to a fresh handoff agent. Each step should leave a "clean state" (Anthropic Nov 2025): commit and append to a progress note, so any step can start cold.
9. **Keep the implementer and the triager separate.** Anthropic found self-evaluation lenient and a skeptical separate evaluator "far more tractable". Our two-axis review already uses fresh subagents. The triage agent should not be the implementer either.
10. **Make the ticket list machine-owned and edit-resistant.** The JSON in the Nov 2025 harness had only `passes` writable. The runner, not an agent, should mark tickets done, after tsc, test and lint pass.
