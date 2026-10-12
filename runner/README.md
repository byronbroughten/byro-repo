# @byronbroughten/spec-runner

Runs a spec's tickets through implement, review, finding triage, fix, checks and wrap-up, one agent step at a time, and leaves the developer a review list. It imports nothing from the repo around it: everything repo-specific is injected config, so it can be split out later. Its words are in [`GLOSSARY.md`](./GLOSSARY.md).

| Export | What it is |
| --- | --- |
| `@byronbroughten/spec-runner/AgentStep` | `AgentStep`: the port that launches one headless `claude -p` step as a cswap account and returns its `StepResult`: the schema-checked record or schema failure, session id, config folder, transcript path, peak context, exit subtype, latest usage reading and any limit hit. |
| `@byronbroughten/spec-runner/ClaudeAgentStep` | The real adapter: runs `cswap run <account> -- -p …` in `acceptEdits` and reads its stream-json, optionally logging it raw. |
| `@byronbroughten/spec-runner/FakeAgentStep` | The adapter run-loop tests script with `StepResult`s. |
| `@byronbroughten/spec-runner/IssueWorkspaces` | The workspace module: `create()` builds an issue workspace (a root worktree outside the primary root with a worktree of each package clone inside, the issue's repo and any named extras on the issue branch, the rest detached at master), or returns the existing one; `promote()` puts a detached repo onto the issue branch partway through a ticket, `resume()` re-detaches the clean detached repos at the primary's current master and fails naming any dirty one, and `list()` and `remove()` read and clear workspaces. Clone paths, the workspace folder, the shared gitignored files, the installer and the title lookup are injected. byro-repo's values are in `scripts/runner/runnerConfig.ts`, behind `npm run issue:list` and `npm run issue:remove -- <repo> <n> [--force]`. |
| `@byronbroughten/spec-runner/SessionProbe` | `SessionProbe`: starts a one-turn, no-tools headless session in a folder with a SessionStart hook added through `--settings`, and returns what that hook saw: `$CLAUDE_PROJECT_DIR`, its cwd and its stdin JSON. Nothing in the folder is edited. Behind `npm run session:probe -- <folder>`. |
| `@byronbroughten/spec-runner/contextMeter` | `ContextMeter`: a session's peak context, the most input + cache-read + cache-creation tokens any one main-loop assistant message carried. Feed it stream-json events with `observe()` and read `peak`, or pass a whole transcript to `ContextMeter.ofTranscript()`. |
| `@byronbroughten/spec-runner/limitGuard` | The limit guard: `readCswapList()` turns `cswap list --json` into per-account readings (a missing one is `undefined`, never thrown), and `decideStep()` picks launch, change account, Limit wait or Stop from them, the pinned account and the day's account changes, with `defaultLimitGuardKnobs` for its thresholds, margin and soft cap. |

## Tests

Vitest, in the root's `tooling` project: `npm test` from the repo root, or `npx vitest run runner` for just these. `npm run tsc` and `npm run lint` from the root reach it too.
