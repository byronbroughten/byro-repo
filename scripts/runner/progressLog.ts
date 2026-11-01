// Prints a spec's progress-log path, or a Batch's first member's, so tmux.sh appends to the file the runner itself writes.
// Usage: node scripts/runner/progressLog.ts <owner/repo> <n> [<n>…].
import { progressLogPathOf } from "@byronbroughten/spec-runner/SpecRun";

import { requiredLaunchArgsOf } from "./launchArgs.ts";
import { stateFolder } from "./runnerConfig.ts";

const launch = requiredLaunchArgsOf(process.argv.slice(2), "progressLog.ts");
const [lead] = launch.members;
console.log(progressLogPathOf(stateFolder, lead));
