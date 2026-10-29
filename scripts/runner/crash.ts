// Writes the run-ended line for a runner that crashed; tmux.sh calls it, since a crashed run writes no end-of-run line of its own.
// Usage: node scripts/runner/crash.ts <owner/repo> <n> <exit code>.
import { writeCrashLine } from "./crashLine.ts";
import { stateFolder } from "./runnerConfig.ts";

const [ownerRepo = "", number = "", code = ""] = process.argv.slice(2);
const [owner = "", repo = ""] = ownerRepo.split("/");
await writeCrashLine(
  { owner, spec: { repo, number: Number(number) }, code },
  stateFolder,
);
