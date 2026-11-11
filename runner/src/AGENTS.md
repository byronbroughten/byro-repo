# Rules for the runner's `src/`

- **Which file holds a module: the [Files](#files) table below**, one row per file. Its words are [`GLOSSARY.md`](../GLOSSARY.md)'s.
- **`SpecRun.ts` only delegates; the `SpecRun/` folder holds one collaborator per concern**, and the table's `SpecRun/` rows name each one's job in one line, so pick the file from there rather than reading `SpecRun/` in ranges.
- **The core imports a Workflow only through the one `Workflow` module, `Workflow.ts`, and neither Workflow imports the other.**
- **Test `SpecRun` through `specRunHarness.ts`**; each `SpecRun.<subject>.test.ts` covers one group, so the nearest one is the model for a new test.
- **Runner tests get real git only through the shared git fixture, `GitFixture.ts`**, except in a fake command or git hook, a shell the code under test starts.
- **A check command run through a harness is a shell builtin or small binary, never `node -e`.**

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
| `Checks.ts` | `Checks` | Runs `npm run check`'s commands at once in the check slot, narrowed to the packages with no check stamp. |
| `CheckSlot.ts` | | The per-primary check slot `npm run check` waits for. |
| `ClaudeAgentStep.ts` | `ClaudeAgentStep` | The real agent-step adapter over `cswap run`, launching under the primary's gate root and settings plus an injected permission hook, with the targets' tools, no other gworkspace tool, and environment. |
| `clonePaths.ts` | `clonePaths` | Builds the repo map, each clone in landing order, from a primary root. |
| `CommittedFiles.ts` | | A set of committed files in one repo, read from HEAD for a check stamp's key, and whether any has a change. |
| `contextMeter.ts` | `contextMeter` | Measures a session's peak context from stream events or a transcript. |
| `contextNudge.ts` | `contextNudge` | Words the handoff reminder once a transcript reaches the ticket budget, for the ticket's handoff, the supervision's or both. |
| `CswapUsageReader.ts` | `CswapUsageReader` | Reads account usage and the Active account from `cswap list --json`. |
| `docPrint.ts` | `docPrint` | `npm run doc:print`'s core: prints a Doc, named by its ID or URL, as the Markdown dialect, through the Docs port its entry passes. |
| `Docs.ts` | | The Docs module's port: reads a Doc as its Markdown, its Sections by heading and the revision read, and writes a Section in place under that revision; it may later move to `packages/` with a folder move. |
| `Docs/DocReader.ts` | | Reads a `documents.get` body into the Markdown dialect. |
| `Docs/docFixtures.ts` | | Loads the `documents.get` JSON fixtures in `Docs/fixtures/` that Docs tests read. |
| `Docs/DocsRequestRefused.ts` | | The error for a request the Docs API refused, with its status. |
| `Docs/FakeBody.ts` | | The character-per-index body, its lists and tables included, that `FakeDocuments` applies `batchUpdate` requests to. |
| `Docs/FakeDocuments.ts` | | The in-memory Docs API Docs tests use: `documents.get` and `batchUpdate` under a revision guard, and a Doc edited as in the editor, now or just before later writes. |
| `Docs/googleDocs.ts` | | The Google Docs layer's types: the `documents.get` body types, the `batchUpdate` requests and its port. |
| `Docs/InlineParser.ts` | | Parses the dialect's inline Markdown back into styled text spans. |
| `Docs/markdownDialect.ts` | | The Markdown dialect's forms and its split into Sections. |
| `Docs/markdownDialect/blockParse.ts` | | The dialect's parse of a Section's body into paragraphs, flat lists and tables. |
| `Docs/PendingSuggestions.ts` | | The error for a write refused because the Doc holds pending suggestions the writer can't index around safely. |
| `Docs/RestDocuments.ts` | `RestDocuments` | The real Docs port over the Docs REST API, as the developer's clasp login in an injected credential file, reading a Doc with its suggestions inline. |
| `Docs/sectionDiff.ts` | | Diffs a Section's blocks as held in the Doc against the ones written, into hunks. |
| `Docs/SectionWriter.ts` | | Turns a Section's new Markdown, its lists and tables included, into the `batchUpdate` requests that change only what differs. |
| `Docs/SectionWriter/BulletPlacer.ts` | | Puts the lists the Section writer writes into bullets, once its text requests have run. |
| `Docs/SectionWriter/HeldSectionReader.ts` | | Reads the Section the writer rewrites out of the Doc as held blocks, refusing what it can't index around. |
| `Docs/StaleRevision.ts` | | The error for a write refused because the Doc changed after the revision read. |
| `EventFileNotices.ts` | `EventFileNotices` | The event-file notice adapter a Supervisor watches, and its readers. |
| `FactsFile.ts` | `FactsFile` | Reads and writes a ticket's facts file. |
| `failureText.ts` | `failureText` | Words a thrown error or failed command, once for every caller. |
| `FakeAgentStep.ts` | `FakeAgentStep` | The scripted agent step run-loop tests use. |
| `FakeGitHub.ts` | | The scripted GitHub port run-loop and wrap-up tests use. |
| `FakeIssueSource.ts` | | The scripted issue source issue-reader and Outline-edit tests use. |
| `FakeNotices.ts` | `FakeNotices` | The notice port run-loop tests read back. |
| `FakeUsageReader.ts` | | The scripted usage reader run-loop tests use. |
| `GhCli.ts` | `GhCli` | The real `gh` port. |
| `git.ts` | | Git helpers the workspaces, run loop and wrap-up share, the worktree add, remove, list and switch helpers and the branch lookup included. |
| `GitFixture.ts` | | A test primary root of clones with bare remotes. |
| `halts.ts` | | Halts: their comments, notices, the resume prompt and the words of the fresh Halt on an Outline edit the runner can't apply and of the push Halts, on a Section and on a Doc's pending suggestions. |
| `halts/haltReplies.ts` | | Reads a developer's replies to a Halt: which answer it, `stop spec` and a Failure or push Halt's answer. |
| `headlessProbe.ts` | | Launches the one-turn headless session both probes run. |
| `IssueReader.ts` | `IssueReader` | `npm run issue:read`: prints an issue as Trusted and Untrusted text, reads a Trusted body's Model fit line for `npm run outcome:summary`, and names a ticket's skill for `npm run issue:start`. |
| `IssueWorkspaces.ts` | `IssueWorkspaces` | Creates, promotes, resumes, leases, lists and removes issue and session workspaces, delegating to `IssueWorkspaces/`. |
| `IssueWorkspaces/BranchNamer.ts` | | Names a workspace's branch, reusing an issue's existing branch in any repo. |
| `IssueWorkspaces/claudeEntries.ts` | `claudeEntries` | The `.claude/` entries the sandbox write-protects in a worktree, and the check that a removal can delete them. |
| `IssueWorkspaces/IssueWorkspacesBase.ts` | | The Base `IssueWorkspaces` and its collaborators share: the config, a repo's clone path and its primary clone, finding a workspace's folder by key and the free-lease check. |
| `IssueWorkspaces/WorkspaceKeeper.ts` | | The workspace lifecycle: creates, finds, lists, promotes, resumes and removes workspaces. |
| `IssueWorkspaces/WorkspaceLeaser.ts` | | Takes, releases and reads workspace leases. |
| `IssueWorkspaces/WorkspaceSeeder.ts` | | Seeds a new workspace's dependencies from the primary's. |
| `IssueWorkspaces/workspaceLeases.ts` | | The lease and lease-holder types and the lease helpers callers and collaborators share. |
| `IssueWorkspaces/workspaceTypes.ts` | | The IssueRef, key and workspace types and the key and issue-set helpers callers and collaborators share. |
| `issueWorkspacesHarness.ts` | | The fixture `IssueWorkspaces` tests share. |
| `LandingLock.ts` | `LandingLock` | The per-primary lock wrap-up lands under. |
| `LeaseHeld.ts` | | The error for another holder's live workspace lease. |
| `limitGuard.ts` | `limitGuard` | The limit guard: reads usage and picks launch or Limit wait. |
| `localTime.ts` | | Words and reads a human-facing time: local, with its zone. |
| `lockFixture.ts` | | Pid-lock fixtures the lock tests share. |
| `modelFit.ts` | `modelFit` | Reads a ticket's Model fit pair and compares pairs. |
| `Notices.ts` | `Notices` | The notice port, its notice kinds and the run endings among them. |
| `outlineApply.ts` | `outlineApply` | `npm run outline:apply`'s core: applies the Outline edits a developer's answer approves to a Trusted spec body, for an interactive `/research-piece` session. |
| `outlineEdits.ts` | | A Research Halt's Outline edits: their schema, ids and words, the ones an answer approves, and their word-for-word application to a spec body's `## Outline`. |
| `outcomeBackfill.ts` | `outcomeBackfill` | A one-off chore's core: fills written outcome rows' `unrecorded` transcript cells from a run state's sessions. |
| `outcomeLog.ts` | `outcomeLog` | The outcome row file's path, table and commit message, and a written row's cells by column and its transcript cells. |
| `outcomeRowWriter.ts` | `outcomeRowWriter` | Writes a ticket's outcome row from its facts file. |
| `outcomeSummary.ts` | `outcomeSummary` | `npm run outcome:summary`'s core: picks spec sections of the outcome log and reports their costs, outliers, transcripts and Model fit for `/mine-outcomes`. |
| `outcomeSummary/OutcomeReport.ts` | | Words the outcome summary for a batch of sections. |
| `outcomeSummary/summarySections.ts` | | Reads the outcome log's spec sections from row files and picks the batch. |
| `PidLock.ts` | | The pid lock file `LandingLock`, `RunLock` and `CheckSlot` extend, and the wait `LandingLock` and `CheckSlot` poll through. |
| `processIdentity.ts` | `processIdentity` | A process named by its pid and start time, for leases, supervision records and a parked watch. |
| `progressLines.ts` | | The progress-log lines, written and parsed in pairs. |
| `ProgressLog.ts` | | A progress log's lines and what the Run board reads from them: the current ticket, the account and the latest line. |
| `promptText.ts` | | Wording helpers the step prompts and the runner's comments share. |
| `recordSchema.ts` | | Schema parts the step records share, the implement record's variants, the review record built from a Workflow's axes and the gap-check record among them, and their validator. |
| `resolveRecords.ts` | | The resolve record every Workflow's resolve step returns: its schema, numbered findings, retry prompt, record and commit checks, and the builder of a Workflow's resolve rules, resolve resuming implement. |
| `reviewList.ts` | `reviewList` | The review list's comment formats, a research ticket's unwanted Unverified facts' audit among them, and undecided count, `runner decide`'s edit marking one item decided or handled, and a session re-review's merge into the posted list. |
| `runBoard.ts` | `runBoard` | The Run board behind `runner status` and `runner watch` with no spec. |
| `runCollecting.ts` | `runCollecting` | Runs one process with its output collected. |
| `runCommand.ts` | | Runs a configured command, returning its output tail when it fails, for the preflight and a ticket's checks. |
| `runKnobs.ts` | `runKnobs` | Every knob a run reads, its defaults and the override-file loader. |
| `RunLock.ts` | `RunLock` | The per-spec run lock. |
| `RunStop.ts` | | The error that ends a run with a Stop. |
| `SandboxProbe.ts` | `SandboxProbe` | `npm run session:probe -- --sandbox-check`: which listed commands a folder's sandbox stops. |
| `savedFormats.ts` | | Reads an older runner's run state, facts file and supervision record into today's shapes. |
| `SchemaFailure.ts` | | The error for a step record that fails its checks. |
| `secretScan.ts` | | Wrap-up's secret scan: the token-shaped lines each pushed commit adds, refused before a push. |
| `secretShapes.ts` | | The token shapes wrap-up's secret scan looks for. |
| `SessionProbe.ts` | `SessionProbe` | `npm run session:probe`: what a SessionStart hook sees in a folder. |
| `sleep.ts` | | A promised delay. |
| `SpecRun.ts` | `SpecRun` | The run loop's entry: `run` over its members, `status`, `requestStop`, `review`, `resolve`, `decide`, `judgeable` and `standalone`, delegating to `SpecRun/`. |
| `SpecRun/DraftPuller.ts` | | Runs a piece spec's drafting ticket's pull: writes and commits the Agent draft its Workflow pulls from the Doc, and keeps the push baseline. |
| `SpecRun/DraftPusher.ts` | | Runs a piece spec's push: writes the Agent draft's agent Sections into the Doc once, raising a push Halt before any write on a Section the developer changed since the pull, reading and comparing again on a stale revision up to a bound, and raising a push Halt naming a Doc with pending suggestions, delegating its `keep mine` answers to `DraftPusher/`. |
| `SpecRun/DraftPusher/DraftKeeper.ts` | | Marks the push's `keep mine` Sections as the developer's in the Agent draft and lands it as a session. |
| `SpecRun/HaltRaiser.ts` | | Raises and posts a ticket's Halts and finds its downstream. |
| `SpecRun/ImplementStepper.ts` | | Runs a ticket's implement step and its handoffs, and creates the kept folder a Workflow names. |
| `SpecRun/JudgeableIssueLister.ts` | | `runner judgeable`: lists a repo's open issues by the Base's judgement, undecided review-list items or ready to close. |
| `SpecRun/LeaseKeeper.ts` | | Takes and releases a ticket's workspace lease and finds its workspace. |
| `SpecRun/MemberSelections.ts` | | One pick's ticket selections across a run's members. |
| `SpecRun/OutlineEditApplier.ts` | | Applies the Outline edits an answered Research Halt approves to the spec body, raising a fresh Research Halt on an edit it can't apply. |
| `SpecRun/PreflightChecker.ts` | | The run's preflight over its member list: run locks, each member's refusals and the shared preflight Stop. |
| `SpecRun/ResearchStepper.ts` | | Runs a piece spec's research ticket's research step and its handoffs, keeps its record, and runs its quote check, sending the step back on red. |
| `SpecRun/ReviewItemDecider.ts` | | `runner decide`: records one item of the developer's own review list as decided or handled. |
| `SpecRun/ReviewListPoster.ts` | | Posts review lists and covered-later notes, and ends the run with its Workflow's spec-end Steps, the gap check's review list, the judge Step's stop and the push included. |
| `SpecRun/ReviewStepper.ts` | | Runs a ticket's review and resolve steps. |
| `SpecRun/RunLoop.ts` | | The run's ticket loop across its members, idling and end. |
| `SpecRun/SessionReviewer.ts` | | Runs `review` and `resolve` for an interactive session. |
| `SpecRun/SpecRunBase.ts` | | The Base every collaborator shares: config, run state, progress log, notices, snapshots, a run's end and an issue's review-list judgement. |
| `SpecRun/StandaloneTicketLister.ts` | | `runner standalone`: lists a repo's launchable Standalone tickets, leaving out each the Batch preflight would refuse, with its reason. |
| `SpecRun/StatusReporter.ts` | | A run's or Batch's status, and its stop request. |
| `SpecRun/StepLauncher.ts` | | Launches an agent step under the limit guard, retries a crash and resumes a step a limit cut off, delegating the limit waits to `StepLauncher/`. |
| `SpecRun/StepLauncher/LimitWaiter.ts` | | Holds a launch until the Active account reads under its thresholds and waits out a limit hit. |
| `SpecRun/TicketLander.ts` | | Lands a ticket: posts a research ticket's comment and raises its Research Halt, writes its facts file, runs the wrap-up and posts its review list, delegating its checks and wrap-up failures to `TicketLander/`. |
| `SpecRun/TicketLander/MasterMerger.ts` | | Takes a ticket's wrap-up failure, merging master into its branch on a conflict and resuming the implementer to resolve it. |
| `SpecRun/TicketLander/TicketChecker.ts` | | Runs a ticket's checks, its Workflow's own included, until green, resuming on red and stopping on a red master. |
| `SpecRun/TicketSelector.ts` | | Picks the run's next ticket, reads Halt answers and has a Research Halt's approved edits applied. |
| `SpecRun/TicketSequencer.ts` | | Runs one ticket's steps from the one it reached, walking the Step sequence its Workflow supplies, and stops one whose sequence ends short of wrap-up. |
| `SpecRun/runState.ts` | | The run-state types and the ticket-state, targets, launch and member-blocking helper bundles several collaborators share. |
| `SpecRun/runState/draftCommits.ts` | | Commits a piece spec's Agent draft in one clone, the pull's and the push's `keep mine` alike, committing nothing when it is unchanged. |
| `SpecRun/runState/runHalts.ts` | | Raises, reads, delivers and orders a run's Halts, finds a ticket's downstream and the spec-end Step a spec issue's Halt holds. |
| `SpecRun/runState/runText.ts` | | Words a run's end, waits and refusals, its rerun command, its review-list judge line and each spec-end Step's name. |
| `SpecRun/runState/statePaths.ts` | | A spec's run state file and progress log paths in the state folder. |
| `SpecRun/runState/ticketSteps.ts` | | A ticket's step sessions, heads, turn caps, live-ceiling phrase and snapshots, the red-checks loop, and reads a step's record, a kept research record and its review facts. |
| `specRunHarness.ts` | | The fixture `SpecRun` tests share. |
| `specRunHarness/stepResults.ts` | | The step results, records and scripted steps `SpecRun` tests give a fake agent step. |
| `specRunHarness/timing.ts` | | The clock `SpecRun` tests start a run at and move through its fakes. |
| `specRunHarness/trackedIssues.ts` | | The tracked issues `SpecRun` tests give a fake GitHub and `Workflow` tests pick from. |
| `stalePaths.ts` | | The stale-path check for `packages/<dir>` mentions with no clone. |
| `StepStream.ts` | | Reads a step's stream-json into its `StepResult`. |
| `stepPrompts/handoffText.ts` | | The handoff wording every Workflow's implement step shares: the nudge section, a fresh step's section, the posted comment and a proposed split's text. |
| `stepPrompts/implementText.ts` | | The bullets the implement step's prompt and the generated `/implement-code` skill share, the ticket-binds section and the implement prompt's workspace section. |
| `stepPrompts/interactiveSkill.ts` | | The generated `/implement-*` skills' shared commands, opening, generated note and ending, which takes its drift and only-writes lines from each skill. |
| `stepPrompts/resolveText.ts` | | The resolve rules, record fields and shared prompt text every Workflow's resolve step uses. |
| `stepPrompts/resumePrompts.ts` | | The prompts sent with `--resume` after a step is cut off, capped or sent back, and the tree-reset note. |
| `stepRecords.ts` | | The records the steps return, with the types, reasons, implement record check and small readers the core shares. |
| `SupervisionRecords.ts` | `SupervisionRecords` | A Supervisor's record of the run or Batch it watches and the lines explained, and its handoff file, read once on a rejoin. |
| `targetTools.ts` | | The tools a step gets for each of its ticket's targets and its spec's sources. |
| `TicketHalted.ts` | | The error raised once a ticket's Halts are posted. |
| `ticketNewDependencies.ts` | | Reads a ticket's `## New dependencies` section. |
| `ticketSections.ts` | | Finds one `## ` section of a ticket's body. |
| `ticketTargets.ts` | | Reads a ticket's `## Targets` section, and holds the target kinds, a spec's source among them. |
| `transcriptFacts.ts` | `transcriptFacts` | Outcome facts computed from transcripts: pair, peaks, duration and cost, and why one is unrecorded; where a session's transcript is. |
| `UnhandledStop.ts` | `UnhandledStop` | The outcomes the run loop doesn't handle yet, and their error. |
| `verdicts.ts` | | A finding's axes, `spec`, `standards` and `reader`, and its verdicts. |
| `Workflow.ts` | | The Workflow type, its spec-end Steps, source targets, pull and push rules, each agent step's rules and prompt input, its outcome row's review cell and the accessors that throw for a step a Workflow leaves out, and the pick of a spec's Workflow, and an interactive session's skill, from the labels: the core's one way to a Workflow. |
| `Workflow/code/codeWorkflow.ts` | `codeWorkflow` | Builds the code Workflow from a repo's checks and review skill: each ticket's Step sequence, the Step each one goes on to, its spec-end Steps and their trigger, its agent steps' rules, resolve resuming implement, and its outcome row's review cell. |
| `Workflow/code/gapCheck.ts` | `gapCheck` | The code gap check's prompt. |
| `Workflow/code/implementCodeSkill.ts` | `implementCodeSkill` | Generates the `/implement-code` skill from the implement step's shared body. |
| `Workflow/code/implementStep.ts` | `implementStep` | The code implement step's prompt and output schema. |
| `Workflow/code/mergeMasterStep.ts` | | The merge-master step's prompt and output schema. |
| `Workflow/code/redChecksStep.ts` | | The red-checks step's prompt and record. |
| `Workflow/code/resolveStep.ts` | `resolveStep` | The code resolve step's prompt. |
| `Workflow/code/reviewStep.ts` | `reviewStep` | The review step's prompt and record schema. |
| `Workflow/piece/agentDraft.ts` | | The Agent draft file's path, Sections and author marks, pull's merge of a Doc's Sections into them, the agent Sections the push writes and the ones its `keep mine` answers mark as the developer's. |
| `Workflow/piece/draftingScope.ts` | `draftingScope` | A drafting ticket's scope, its named Sections or every agent Section on a `final-pass` ticket, read from its labels and worded for the prompts. |
| `Workflow/piece/gapCheck.ts` | | The piece gap check's prompt. |
| `Workflow/piece/implementPieceSkill.ts` | `implementPieceSkill` | Generates the `/implement-piece` skill from the piece implement step's drafting lines. |
| `Workflow/piece/implementStep.ts` | | The piece implement step's prompt, the drafting lines `/implement-piece` shares, passages folder, output schema, record and record checks. |
| `Workflow/piece/pieceChecks.ts` | | A drafting ticket's checks: overlap and the spec's length limit, and the prompts' wording of an overlap run and its fixes. |
| `Workflow/piece/pieceWorkflow.ts` | `pieceWorkflow` | Builds the piece Workflow from a repo's overlap and quote commands and Docs port: its research and drafting Steps, research, implement, review, resolve and red-checks agent steps, its spec-end Steps and their trigger, pull and push rules, quote check, drafting checks, outcome row review cell and the source targets read from the spec's Supporting Material. |
| `Workflow/piece/redChecksStep.ts` | | The piece red-checks step's prompt, fixing red piece checks in the Agent draft, and its output schema. |
| `Workflow/piece/researchStep.ts` | | The research step's prompt, its red-quotes section, handoff comment, record checks, output schema, closing comment and Research Halt words. |
| `Workflow/piece/resolveStep.ts` | | The piece resolve step's prompt, pointing at the verdict rules' `## Piece findings` and rerunning the piece checks after its Fixes, and its record checks, which refuse the verdict reasons a piece finding never takes. |
| `Workflow/piece/reviewCaught.ts` | | A piece outcome row's "What review caught" cell: each kept finding by its axis and public rule name only. |
| `Workflow/piece/reviewStep.ts` | | The piece review step's prompt, reading `/review-piece` by its path over the Agent draft and passages folder, and its record schema. |
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
