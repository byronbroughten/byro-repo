# Rules for the runner's `src/`

- **Which file holds a module: the [Files](#files) table below**, one row per file. Its words are [`GLOSSARY.md`](../GLOSSARY.md)'s.
- **`SpecRun.ts` only delegates; the `SpecRun/` folder holds one collaborator per concern**, and the table's `SpecRun/` rows name each one's job in one line, so pick the file from there rather than reading `SpecRun/` in ranges.
- **Test `SpecRun` through `specRunHarness.ts`**; each `SpecRun.<subject>.test.ts` covers one group, so the nearest one is the model for a new test.

## Files

One row per file under `src/`, tests aside, each naming only the file's job; behaviour is in the code and the glossary. An exported file is imported as `@byronbroughten/spec-runner/<export>`.

| File | Export | Job |
| --- | --- | --- |
| `AGENTS.md` | | The rules for working in `src/`; `CLAUDE.md` loads it. |
| `CLAUDE.md` | | Loads `AGENTS.md` for Claude Code. |
| `ActiveAccountUnknown.ts` | | The Stop raised when no Active account can be read for a fresh step. |
| `AgentStep.ts` | `AgentStep` | The port that launches one headless `claude -p` step and its `StepResult`. |
| `Checks.ts` | `Checks` | Runs `npm run check`'s commands at once, skipped on a check stamp. |
| `ClaudeAgentStep.ts` | `ClaudeAgentStep` | The real agent-step adapter over `cswap run`, with its tools, settings and target environment. |
| `claudeWriteDecision.ts` | | Decides whether a step may Edit or Write a `.claude/` file the allowed write globs name. |
| `claudeWriteHook.ts` | | The PermissionRequest hook script `ClaudeAgentStep` registers over that decision. |
| `clonePaths.ts` | `clonePaths` | Builds the repo map, each clone in landing order, from a primary root. |
| `contextMeter.ts` | `contextMeter` | Measures a session's peak context from stream events or a transcript. |
| `contextNudge.ts` | `contextNudge` | Words the handoff reminder once a transcript reaches the ticket budget. |
| `CswapUsageReader.ts` | `CswapUsageReader` | Reads account usage and the Active account from `cswap list --json`. |
| `EventFileNotices.ts` | `EventFileNotices` | The event-file notice adapter a Supervisor watches, and its readers. |
| `FactsFile.ts` | `FactsFile` | Reads and writes a ticket's facts file. |
| `failureText.ts` | `failureText` | Words a thrown error or failed command, once for every caller. |
| `FakeAgentStep.ts` | `FakeAgentStep` | The scripted agent step run-loop tests use. |
| `FakeGitHub.ts` | | The scripted GitHub port run-loop and wrap-up tests use. |
| `FakeIssueSource.ts` | | The scripted issue source issue-reader tests use. |
| `FakeNotices.ts` | `FakeNotices` | The notice port run-loop tests read back. |
| `FakeUsageReader.ts` | | The scripted usage reader run-loop tests use. |
| `gapCheck.ts` | `gapCheck` | The gap check's prompt and record. |
| `GhCli.ts` | `GhCli` | The real `gh` port. |
| `git.ts` | | Git helpers the workspaces, run loop and wrap-up share. |
| `GitFixture.ts` | | A test primary root of clones with bare remotes. |
| `halts.ts` | | Halts: their comments, notices, answers and the resume prompt. |
| `implementCodeSkill.ts` | `implementCodeSkill` | Generates the `/implement-code` skill from the implement step's shared body. |
| `implementStep.ts` | `implementStep` | The implement step's prompt, record, handoff comment and record checks. |
| `IssueReader.ts` | `IssueReader` | `npm run issue:read`: prints an issue as Trusted and Untrusted text. |
| `IssueWorkspaces.ts` | `IssueWorkspaces` | Creates, promotes, resumes, leases, lists and removes issue and session workspaces. |
| `issueWorkspacesHarness.ts` | | The fixture `IssueWorkspaces` tests share. |
| `LandingLock.ts` | `LandingLock` | The per-primary lock wrap-up lands under. |
| `LeaseHeld.ts` | | The error for another holder's live workspace lease. |
| `limitGuard.ts` | `limitGuard` | The limit guard: reads usage and picks launch, Limit wait or Stop. |
| `lockFixture.ts` | | Pid-lock fixtures the lock tests share. |
| `mergeMasterStep.ts` | | The merge-master step's prompt and record. |
| `modelFit.ts` | `modelFit` | Reads a ticket's Model fit pair and compares pairs. |
| `Notices.ts` | `Notices` | The notice port and `composedNotices`. |
| `NtfyNotices.ts` | `NtfyNotices` | The ntfy push adapter. |
| `outcomeLog.ts` | `outcomeLog` | The outcome row file's path, table and commit message. |
| `outcomeRowWriter.ts` | `outcomeRowWriter` | Writes a ticket's outcome row from its facts file. |
| `PidLock.ts` | | The pid lock file `LandingLock` and `RunLock` extend. |
| `processStart.ts` | | A process's start time, for leases and supervision records. |
| `progressLines.ts` | | The progress-log lines, written and parsed in pairs. |
| `promptText.ts` | | Wording helpers the step prompts share. |
| `recordSchema.ts` | | Schema parts the step records share, and their validator. |
| `redChecksStep.ts` | | The red-checks step's prompt and record. |
| `resolveStep.ts` | `resolveStep` | The resolve step's prompt, record and record and commit checks. |
| `reviewList.ts` | `reviewList` | The review list's comment formats and undecided count. |
| `reviewStep.ts` | `reviewStep` | The review step's prompt, record and finding types. |
| `runBoard.ts` | `runBoard` | The Run board behind `runner status` and `runner watch` with no spec. |
| `runCollecting.ts` | `runCollecting` | Runs one process with its output collected. |
| `runKnobs.ts` | `runKnobs` | Every knob a run reads, its defaults and the override-file loader. |
| `RunLock.ts` | `RunLock` | The per-spec run lock. |
| `RunStop.ts` | | The error that ends a run with a Stop. |
| `savedFormats.ts` | | Reads an older runner's run state and facts file into today's shapes. |
| `SchemaFailure.ts` | | The error for a step record that fails its checks. |
| `secretShapes.ts` | | The token shapes wrap-up's secret scan looks for. |
| `SessionProbe.ts` | `SessionProbe` | `npm run session:probe`: what a SessionStart hook sees in a folder. |
| `sleep.ts` | | A promised delay. |
| `SpecRun.ts` | `SpecRun` | The run loop's entry: `run`, `status`, `requestStop`, `review` and `resolve`, delegating to `SpecRun/`. |
| `SpecRun/HaltRaiser.ts` | | Raises and posts a ticket's Halts and finds its downstream. |
| `SpecRun/ImplementStepper.ts` | | Runs a ticket's implement step and its handoffs. |
| `SpecRun/LeaseKeeper.ts` | | Takes and releases a ticket's workspace lease and finds its workspace. |
| `SpecRun/ReviewListPoster.ts` | | Posts review lists and covered-later notes, and ends the run with the gap check. |
| `SpecRun/ReviewStepper.ts` | | Runs a ticket's review and resolve steps. |
| `SpecRun/RunLoop.ts` | | The run's preflight, ticket loop, idling and end. |
| `SpecRun/SessionReviewer.ts` | | Runs `review` and `resolve` for an interactive session. |
| `SpecRun/SpecRunBase.ts` | | The Base every collaborator shares: config, run state, progress log, notices and snapshots. |
| `SpecRun/StepLauncher.ts` | | Launches an agent step under the limit guard and retries a crash. |
| `SpecRun/TicketLander.ts` | | Runs a ticket's checks and lands it. |
| `SpecRun/TicketSelector.ts` | | Picks the run's next ticket and reads Halt answers. |
| `SpecRun/TicketSequencer.ts` | | Runs one ticket's steps from the one it reached. |
| `SpecRun/runState.ts` | | The run-state types and the helpers several collaborators share. |
| `specRunHarness.ts` | | The fixture `SpecRun` tests share. |
| `stalePaths.ts` | | The stale-path check for `packages/<dir>` mentions with no clone. |
| `StepStream.ts` | | Reads a step's stream-json into its `StepResult`. |
| `SupervisionRecords.ts` | `SupervisionRecords` | A Supervisor's record of the run it watches and the lines explained. |
| `targetTools.ts` | | The tools a step gets for each of its ticket's targets. |
| `TicketHalted.ts` | | The error raised once a ticket's Halts are posted. |
| `ticketTargets.ts` | | Reads a ticket's `## Targets` section. |
| `transcriptFacts.ts` | `transcriptFacts` | Outcome facts computed from transcripts: pair, peaks, duration and cost. |
| `UnhandledStop.ts` | `UnhandledStop` | The outcomes the run loop doesn't handle yet, and their error. |
| `verdicts.ts` | | A finding's axes and verdicts. |
| `WrapUp.ts` | `WrapUp` | `npm run wrap-up`: lands an issue or session workspace. |
| `WrapUpFailure.ts` | `WrapUpFailure` | The typed failure a wrap-up stops on. |
| `wrapUpHarness.ts` | | The fixture `WrapUp` tests share. |
