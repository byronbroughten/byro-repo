# @byronbroughten/spec-runner

Runs a spec's tickets through implement, review, resolve (which commits the fixes), checks and wrap-up, one agent step at a time, and leaves the developer a review list. Its code imports nothing from the repo around it: everything repo-specific is injected config, so it can be split out later. Its words are in [`GLOSSARY.md`](./GLOSSARY.md).

## Files

Each file under `src/`, with its job and any export, is listed in [`src/AGENTS.md`](./src/AGENTS.md#files). byro-repo's config for all of them is `scripts/runner/runnerConfig.ts`, its knob overrides `scripts/runner/runner.config.json`.

## Context nudge

Once a ticket session's context reaches its budget, the runner reminds it to write a handoff. `contextNudge` words the reminder, and each repo registers its own Claude Code hook to call it; `src/contextNudge.ts`'s header says how.

## Running under tmux

`npm run runner:tmux -- <owner/repo> <n>` starts the run in a detached tmux session, `runner-<repo>-<n>`, under `caffeinate -is` so the Mac stays awake; attach with `tmux attach -t runner-<repo>-<n>`. It then waits up to two minutes for a `run-started` or `run-ended` line newer than the launch, prints it, and exits 0 on `run-started`, 1 on `run-ended` or, when neither came, after saying the run's state is unknown (`scripts/runner/launchWait.ts`, over `runWatch.ts`). A Supervisor watches the run with `npm run runner -- watch <owner/repo> <n>`, whose semantics are the [`/runner` skill's](./skills/runner/SKILL.md#2-watch). On a crash the wrapper sends a push to `runner.local.json`'s topic and writes a `run-ended` line marked `crashed` to the event file (`scripts/runner/crash.ts`, over `crashPush.ts`), since a crashed run sends neither of its own, and the pane stays open with the error. Check on a run from any terminal with `npm run runner -- status <owner/repo> <n>`, or on every running run with `npm run runner -- watch`, the Run board, and end it after its current ticket with `npm run runner -- stop <owner/repo> <n>`.

## Skills

The runner's interactive skills live in `skills/<name>/`: `/implement-code <repo>#<n>` implements one ticket in its issue workspace and lands it once the developer says go (generated, see `implementCodeSkill`); `/judge-findings <repo> #<spec>` puts a spec's undecided review-list items to the developer in rounds, makes or files the fixes they settle, and closes the spec when none is left; `/mine-outcomes <repo> #<spec>` turns a landed spec's outcome rows into model-fit and process proposals, offers `/retro` on its outlier tickets and then clears the rows; `/runner <owner/repo> <n>` makes the session a spec run's Supervisor, launching it through `runner:tmux` or rejoining it, explaining each event-file line with a suggested reply, posting only replies the developer settled, and stopping the run once they agree. byro-repo loads each one through a symlink in `.claude/skills/`, not a plugin ([layout](../docs/agents/upstream-skills.md#layout)). The skills link byro-repo's docs.

## Tests

Vitest, in the root's `tooling` project: `npm test` from the repo root, or `npx vitest run runner` for just these. `npm run tsc` and `npm run lint` from the root reach it too.
