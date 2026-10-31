// Writes the run-ended line for a runner that crashed; tmux.sh calls it, since a crashed run writes no end-of-run line of its own.
// Usage: node scripts/runner/crash.ts <exit code> <owner/repo> <n> [<n>…].
import { writeCrashLine } from "./crashLine.ts";
import { requiredLaunchArgsOf } from "./launchArgs.ts";
import { stateFolder } from "./runnerConfig.ts";

const [code = "", ...args] = process.argv.slice(2);
const launch = requiredLaunchArgsOf(args, "crash.ts");
await writeCrashLine({ ...launch, code }, stateFolder);
