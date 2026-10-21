# Rules for the runner's `src/`

- **Which file holds a module: the export table in [`runner/README.md`](../README.md)**, one row per file. Read only the rows you need; its words are [`GLOSSARY.md`](../GLOSSARY.md)'s.
- **`SpecRun.ts` is one large class; grep its method names by phase rather than reading it in ranges:**
  - Run loop and selection: `run`, `_startRun`, `_select`, `_survey`, `_preflightStop`, `status`, `requestStop`.
  - Leases and workspaces: `_takeLease`, `_releaseLeaseOf`, `_otherHolderOf`, `_workspaceFor`.
  - Per-ticket flow: `_runTicket`, `_runSteps`, `_runEachStep`.
  - Implement and hand-off: `_implement*`, `_handOff*`, `_takeImplementRecord`, `_resume*`.
  - Review, triage and fix: `_review`, `_triage`, `_fix`, `_runFixer*`, `_fixerSessionOf`.
  - Step launch and retry: `_launch`, `_runStep`, `_retryStep`, `_attemptStep`, `_waitForLaunch`, `_stopOnLimitHit`.
  - Halts: `_halt`, `_postHalts`, `_postUnpostedHalts`, `_raiseBlockerHalts`; formats and reply matching are `halts.ts`.
  - Checks and landing: `_check`, `_redChecksOf`, `_land`, `_mergeMaster`, `_writeFacts`.
  - Review list and gap check: `_postReviewList*`, `_gapCheck*`, `_finish`.
  - Run state: the `Run` and `TicketRun` types, `_readState`, `_saveState`, `_advance`.
- **Test `SpecRun` through `specRunHarness.ts`**; each `SpecRun.<subject>.test.ts` covers one phase, so the nearest one is the model for a new test.
