// Waits for a just-launched run's run-started or run-ended line and prints it; tmux.sh calls it after starting the run's session.
// Usage: node scripts/runner/launchWait.ts <launch time, ISO> <owner/repo> <n> [<n>…].
// Exits 0 on run-started and 1 on run-ended or once the wait runs out with neither.
import { setTimeout as sleep } from "node:timers/promises";

import { requiredLaunchArgsOf } from "./launchArgs.ts";
import { stateFolder } from "./runnerConfig.ts";
import { awaitRunStart, launchReportOf } from "./runWatch.ts";

const waitOptions = { timeoutMs: 120_000, pollMs: 1_000 } as const;

const [launchedAt = "", ...args] = process.argv.slice(2);
const launch = requiredLaunchArgsOf(args, "launchWait.ts");
const result = await awaitRunStart(
  launch.members,
  { ...waitOptions, launchedAt: new Date(launchedAt) },
  { stateFolder, now: () => new Date(), sleep },
);
const { text, exitCode } = launchReportOf(launch.members, result, waitOptions);
console.log(text);
process.exitCode = exitCode;
