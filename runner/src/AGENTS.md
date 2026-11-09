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
| `ActiveAccountUnknown.ts` | | The Stop raised when no Active account can be read for a step. |
| `AgentStep.ts` | `AgentStep` | The port that launches one headless `claude -p` step and its `StepResult`. |
| `BatchRecords.ts` | `BatchRecords` | A Batch's record: its members, process and one event file, found by any member. |
| `callOfItsOwn.ts` | `callOfItsOwn` | Words the advice to run a command in a call of its own, once for the hooks, the runner and the scripts lint. |
| `Checks.ts` | `Checks` | Runs `npm run check`'s commands at once, skipped on a check stamp. |
| `ClaudeAgentStep.ts` | `ClaudeAgentStep` | The real agent-step adapter over `cswap run`, launching under the primary's gate root and settings plus an injected permission hook, with the targets' tools and environment. |
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
| `git.ts` | | Git helpers the workspaces, run loop and wrap-up share, the worktree add, remove, list and switch helpers and the branch lookup included. |
| `GitFixture.ts` | | A test primary root of clones with bare remotes. |
| `halts.ts` | | Halts: their comments, notices and the resume prompt. |
| `halts/haltReplies.ts` | | Reads a developer's replies to a Halt: which answer it, `stop spec` and a Failure Halt's answer. |
| `headlessProbe.ts` | | Launches the one-turn headless session both probes run. |
| `implementCodeSkill.ts` | `implementCodeSkill` | Generates the `/implement-code` skill from the implement step's shared body. |
| `implementStep.ts` | `implementStep` | The implement step's prompt, record, handoff comment and record checks. |
| `IssueReader.ts` | `IssueReader` | `npm run issue:read`: prints an issue as Trusted and Untrusted text, and reads a Trusted body's Model fit line for `npm run outcome:summary`. |
| `IssueWorkspaces.ts` | `IssueWorkspaces` | Creates, promotes, resumes, leases, lists and removes issue and session workspaces, delegating to `IssueWorkspaces/`. |
| `IssueWorkspaces/BranchNamer.ts` | | Names a workspace's branch, reusing an issue's existing branch in any repo. |
| `IssueWorkspaces/claudeEntries.ts` | `claudeEntries` | The `.claude/` entries the sandbox write-protects in a worktree, and the check that a removal can delete them. |
| `IssueWorkspaces/IssueWorkspacesBase.ts` | | The Base `IssueWorkspaces` and its collaborators share: the config, a repo's clone path and its primary clone, finding a workspace's folder by key and the free-lease check. |
| `IssueWorkspaces/WorkspaceKeeper.ts` | | The workspace lifecycle: creates, finds, lists, promotes, resumes and removes workspaces. |
| `IssueWorkspaces/WorkspaceLeaser.ts` | | Takes, releases and reads workspace leases. |
| `IssueWorkspaces/WorkspaceSeeder.ts` | | Seeds a new workspace's dependencies from the primary's. |
| `IssueWorkspaces/workspaceTypes.ts` | | The workspace, key and lease types and the key, issue-set and lease helpers callers and collaborators share. |
| `issueWorkspacesHarness.ts` | | The fixture `IssueWorkspaces` tests share. |
| `LandingLock.ts` | `LandingLock` | The per-primary lock wrap-up lands under. |
| `LeaseHeld.ts` | | The error for another holder's live workspace lease. |
| `limitGuard.ts` | `limitGuard` | The limit guard: reads usage and picks launch, Limit wait or Stop. |
| `localTime.ts` | | Words and reads a human-facing time: local, with its zone. |
| `lockFixture.ts` | | Pid-lock fixtures the lock tests share. |
| `mergeMasterStep.ts` | | The merge-master step's prompt and record. |
| `modelFit.ts` | `modelFit` | Reads a ticket's Model fit pair and compares pairs. |
| `Notices.ts` | `Notices` | The notice port and `composedNotices`. |
| `NtfyNotices.ts` | `NtfyNotices` | The ntfy push adapter. |
| `outcomeBackfill.ts` | `outcomeBackfill` | A one-off chore's core: fills written outcome rows' `unrecorded` transcript cells from a run state's sessions. |
| `outcomeLog.ts` | `outcomeLog` | The outcome row file's path, table and commit message, and a written row's cells by column and its transcript cells. |
| `outcomeRowWriter.ts` | `outcomeRowWriter` | Writes a ticket's outcome row from its facts file. |
| `outcomeSummary.ts` | `outcomeSummary` | `npm run outcome:summary`'s core: picks spec sections of the outcome log and reports their costs, outliers, transcripts and Model fit for `/mine-outcomes`. |
| `outcomeSummary/OutcomeReport.ts` | | Words the outcome summary for a batch of sections. |
| `outcomeSummary/summarySections.ts` | | Reads the outcome log's spec sections from row files and picks the batch. |
| `PidLock.ts` | | The pid lock file `LandingLock` and `RunLock` extend. |
| `processIdentity.ts` | | A process named by its pid and start time, for leases and supervision records. |
| `progressLines.ts` | | The progress-log lines, written and parsed in pairs. |
| `ProgressLog.ts` | | A progress log's lines and what the Run board reads from them: the current ticket, the account and the latest line. |
| `promptText.ts` | | Wording helpers the step prompts share. |
| `recordSchema.ts` | | Schema parts the step records share, and their validator. |
| `redChecksStep.ts` | | The red-checks step's prompt and record. |
| `resolveStep.ts` | `resolveStep` | The resolve step's prompt, record and record and commit checks. |
| `reviewList.ts` | `reviewList` | The review list's comment formats and undecided count, `runner decide`'s edit marking one item decided or handled, and a session re-review's merge into the posted list. |
| `reviewStep.ts` | `reviewStep` | The review step's prompt, record and finding types. |
| `runBoard.ts` | `runBoard` | The Run board behind `runner status` and `runner watch` with no spec. |
| `runCollecting.ts` | `runCollecting` | Runs one process with its output collected. |
| `runCommand.ts` | | Runs a knob's command, returning its output tail when it fails, for the preflight and the landing. |
| `runKnobs.ts` | `runKnobs` | Every knob a run reads, its defaults and the override-file loader. |
| `RunLock.ts` | `RunLock` | The per-spec run lock. |
| `RunStop.ts` | | The error that ends a run with a Stop. |
| `SandboxProbe.ts` | `SandboxProbe` | `npm run session:probe -- --sandbox-check`: which listed commands a folder's sandbox stops. |
| `savedFormats.ts` | | Reads an older runner's run state, facts file and supervision record into today's shapes. |
| `SchemaFailure.ts` | | The error for a step record that fails its checks. |
| `secretScan.ts` | | Wrap-up's secret scan: the token-shaped lines a diff adds, refused before a push. |
| `secretShapes.ts` | | The token shapes wrap-up's secret scan looks for. |
| `SessionProbe.ts` | `SessionProbe` | `npm run session:probe`: what a SessionStart hook sees in a folder. |
| `sleep.ts` | | A promised delay. |
| `SpecRun.ts` | `SpecRun` | The run loop's entry: `run` over its members, `status`, `requestStop`, `review`, `resolve`, `decide`, `judgeable` and `standalone`, delegating to `SpecRun/`. |
| `SpecRun/HaltRaiser.ts` | | Raises and posts a ticket's Halts and finds its downstream. |
| `SpecRun/ImplementStepper.ts` | | Runs a ticket's implement step and its handoffs. |
| `SpecRun/JudgeableIssueLister.ts` | | `runner judgeable`: lists a repo's open issues by the Base's judgement, undecided review-list items or ready to close. |
| `SpecRun/LeaseKeeper.ts` | | Takes and releases a ticket's workspace lease and finds its workspace. |
| `SpecRun/MemberSelections.ts` | | One pick's ticket selections across a run's members. |
| `SpecRun/PreflightChecker.ts` | | The run's preflight over its member list: run locks, each member's refusals and the shared preflight Stop. |
| `SpecRun/ReviewItemDecider.ts` | | `runner decide`: records one item of the developer's own review list as decided or handled. |
| `SpecRun/ReviewListPoster.ts` | | Posts review lists and covered-later notes, and ends the run with the gap check. |
| `SpecRun/ReviewStepper.ts` | | Runs a ticket's review and resolve steps. |
| `SpecRun/RunLoop.ts` | | The run's ticket loop across its members, idling and end. |
| `SpecRun/SessionReviewer.ts` | | Runs `review` and `resolve` for an interactive session. |
| `SpecRun/SpecRunBase.ts` | | The Base every collaborator shares: config, run state, progress log, notices, snapshots, a run's end and an issue's review-list judgement. |
| `SpecRun/StandaloneTicketLister.ts` | | `runner standalone`: lists a repo's launchable Standalone tickets, leaving out each the Batch preflight would refuse, with its reason. |
| `SpecRun/StatusReporter.ts` | | A run's or Batch's status, and its stop request. |
| `SpecRun/StepLauncher.ts` | | Launches an agent step under the limit guard and retries a crash. |
| `SpecRun/TicketLander.ts` | | Runs a ticket's checks and lands it. |
| `SpecRun/TicketSelector.ts` | | Picks the run's next ticket and reads Halt answers. |
| `SpecRun/TicketSequencer.ts` | | Runs one ticket's steps from the one it reached. |
| `SpecRun/runState.ts` | | The run-state types and the ticket-state, targets, launch and member-blocking helpers several collaborators share. |
| `SpecRun/runState/runHalts.ts` | | Raises, reads, delivers and orders a run's Halts, and finds a ticket's downstream. |
| `SpecRun/runState/runText.ts` | | Words a run's end, waits and refusals, its rerun command and its review-list judge line. |
| `SpecRun/runState/statePaths.ts` | | A spec's run state file and progress log paths in the state folder. |
| `SpecRun/runState/ticketSteps.ts` | | A ticket's step sessions, heads, turn caps, live-ceiling phrase and snapshots, and reads a step's record and its review facts. |
| `specRunHarness.ts` | | The fixture `SpecRun` tests share. |
| `stalePaths.ts` | | The stale-path check for `packages/<dir>` mentions with no clone. |
| `StepStream.ts` | | Reads a step's stream-json into its `StepResult`. |
| `SupervisionRecords.ts` | `SupervisionRecords` | A Supervisor's record of the run or Batch it watches and the lines explained. |
| `targetTools.ts` | | The tools a step gets for each of its ticket's targets. |
| `TicketHalted.ts` | | The error raised once a ticket's Halts are posted. |
| `ticketNewDependencies.ts` | | Reads a ticket's `## New dependencies` section. |
| `ticketSections.ts` | | Finds one `## ` section of a ticket's body. |
| `ticketTargets.ts` | | Reads a ticket's `## Targets` section. |
| `transcriptFacts.ts` | `transcriptFacts` | Outcome facts computed from transcripts: pair, peaks, duration and cost, and why one is unrecorded; where a session's transcript is. |
| `UnhandledStop.ts` | `UnhandledStop` | The outcomes the run loop doesn't handle yet, and their error. |
| `verdicts.ts` | | A finding's axes and verdicts. |
| `WrapUp.ts` | `WrapUp` | `npm run wrap-up`: lands an issue or session workspace, delegating its landing steps and closing the issue to `WrapUp/`; and `npm run research:push`'s push. |
| `WrapUp/BranchDeleter.ts` | | Deletes a landing's branches on each remote and locally, recording the ones that failed. |
| `WrapUp/BranchLander.ts` | | Lands a landing's branches up to the fast-forward: restores, clean check, files changed, stale paths, unnamed new dependencies, build and rebuild. |
| `WrapUp/BranchMerger.ts` | | Merges a landing's branches in the workspace, installs changed dependencies and runs the checks, or switches the workspace's repos to master. |
| `WrapUp/IssueCloser.ts` | | Closes a landed ticket's issue or leaves a Standalone one open, and reads its parent, spec and handoff sessions. |
| `WrapUp/LandingBranchFinder.ts` | | Finds the branches a landing merges, the repos whose workspace branch is ahead of master, and the branches its workspace made. |
| `WrapUp/LandingKindPicker.ts` | | Picks what differs between a ticket that lands branches, one with no code and a session. |
| `WrapUp/LandingPusher.ts` | | Scans a landing's added lines for token shapes, then pushes each master. |
| `WrapUp/LogRowCommitter.ts` | | Writes a ticket's outcome row into the merged root checkout and commits it. |
| `WrapUp/MasterFastForwarder.ts` | | Fast-forwards each primary's master under the landing locks, installs changed dependencies, then runs the after hook and pushes. |
| `WrapUp/packageDependencies.ts` | | Reads a `package.json`'s dependency names and version ranges, compares them between commits and finds the names a branch adds. |
| `WrapUp/ResearchPusher.ts` | | `npm run research:push`: pushes a Workspace checkout's `research/*` branch behind the secret scan. |
| `WrapUp/WorkspaceFinisher.ts` | | Checks a workspace's lease is free, levels a kept session's repos with master and removes the workspace. |
| `WrapUp/WorktreeRestorer.ts` | | Puts a landing's worktrees back where they were before a build. |
| `WrapUp/WrapUpBase.ts` | | The Base `WrapUp` and its collaborators share: the config, knobs, network retries, log, a landing's step progress, where its repos and workspace are, the dependency install and the push. |
| `WrapUp/wrapUpTypes.ts` | | The config, GitHub port, parent and landing types, the install command's label and the labels `WrapUp` and its collaborators share. |
| `WrapUpFailure.ts` | `WrapUpFailure` | The typed failure a wrap-up stops on. |
| `wrapUpHarness.ts` | | The fixture `WrapUp` tests share. |
