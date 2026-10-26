// Waits for a just-launched run's run-started or run-ended line and prints it; tmux.sh calls it after starting the run's session.
// Usage: node scripts/runner/launchWait.ts <owner/repo> <n> <launch time, ISO>.
// Exits 0 on run-started and 1 on run-ended or once the wait runs out with neither.
import { setTimeout as sleep } from "node:timers/promises";

import { stateFolder } from "./runnerConfig.ts";
import { awaitRunStart, tmuxSessionOf } from "./runWatch.ts";

const waitOptions = { timeoutMs: 120_000, pollMs: 1_000 } as const;

const [ownerRepo = "", number = "", launchedAt = ""] = process.argv.slice(2);
const spec = { repo: ownerRepo.split("/")[1] ?? "", number: Number(number) };
const result = await awaitRunStart(
  spec,
  { ...waitOptions, launchedAt: new Date(launchedAt) },
  { stateFolder, now: () => new Date(), sleep },
);
if (result.kind === "unknown") {
  console.log(
    `The run's state is unknown: no run-started or run-ended line after ${waitOptions.timeoutMs / 1_000}s; read its pane with: tmux attach -t ${tmuxSessionOf(spec)}`,
  );
  process.exitCode = 1;
} else {
  console.log(result.line);
  if (result.kind === "ended") process.exitCode = 1;
}
