// Prints a spec's progress-log path, so tmux.sh appends to the file the runner itself writes.
// Usage: node scripts/runner/progressLog.ts <owner/repo> <n>.
import { progressLogPathOf } from "@byronbroughten/spec-runner/SpecRun";

import { stateFolder } from "./runnerConfig.ts";

const [ownerRepo = "", number = ""] = process.argv.slice(2);
const [, repo = ""] = ownerRepo.split("/");
console.log(progressLogPathOf(stateFolder, { repo, number: Number(number) }));
