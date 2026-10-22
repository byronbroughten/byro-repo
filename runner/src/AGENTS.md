# Rules for the runner's `src/`

- **Which file holds a module: the export table in [`runner/README.md`](../README.md)**, one row per file. Read only the rows you need; its words are [`GLOSSARY.md`](../GLOSSARY.md)'s.
- **`SpecRun` is split across `SpecRun.ts` and the `SpecRun/` folder; grep its method names by group rather than reading the files in ranges:**
  - Shared helpers and run state, every member more than one group calls: [`SpecRun/SpecRunBase.ts`](./SpecRun/SpecRunBase.ts); the run's types and shared module functions: [`SpecRun/runState.ts`](./SpecRun/runState.ts).
  - Run loop and selection: `run`, `_select`, `_survey`, `_preflightStop`, `status`, `requestStop`.
  - Leases and workspaces: `_takeLease`, `_releaseLeaseOf`, `_otherHolderOf`, `_workspaceFor`.
  - Per-ticket flow: `_runTicket`, `_runSteps`, `_runEachStep`.
  - Implement, hand-off and resume: [`SpecRun/ImplementStepper.ts`](./SpecRun/ImplementStepper.ts).
  - Review, triage and fix: [`SpecRun/ReviewStepper.ts`](./SpecRun/ReviewStepper.ts).
  - Step launch and retry: [`SpecRun/StepLauncher.ts`](./SpecRun/StepLauncher.ts).
  - Halts, crashes and a ticket's downstream: [`SpecRun/HaltRaiser.ts`](./SpecRun/HaltRaiser.ts); formats and reply matching are `halts.ts`.
  - Checks and landing: `_check`, `_redChecksOf`, `_land`, `_mergeMaster`, `_writeFacts`.
  - Review list and gap check: `_postReviewList*`, `_gapCheck*`, `_finish`.
- **Test `SpecRun` through `specRunHarness.ts`**; each `SpecRun.<subject>.test.ts` covers one group, so the nearest one is the model for a new test.
