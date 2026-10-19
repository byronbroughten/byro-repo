// Runs a spec's tickets to landed, one at a time; rerunning the same command resumes. Progress is in .runner/<repo>-<n>.log.
// Usage: npm run runner -- [status|stop] <owner/repo> <n>. Exit 1 is a run that ended short of finished; 2 is a crash, which tmux.sh pushes.
import { SpecRun } from "@byronbroughten/spec-runner/SpecRun";

import { specRunConfigOf } from "./runnerConfig.ts";

const usage = "Usage: npm run runner -- [status|stop] <owner/repo> <n>";

try {
  const args = process.argv.slice(2);
  const command =
    args[0] === "status" || args[0] === "stop" ? args.shift() : "run";
  const [ownerRepo = "", number] = args;
  const [owner, repo] = ownerRepo.split("/");
  if (!owner || !repo || !Number.isInteger(Number(number))) {
    throw new Error(usage);
  }
  const specIssue = { repo, number: Number(number) };
  const specRun = SpecRun.init(specRunConfigOf(owner));
  if (command === "status") {
    console.log(await specRun.status(specIssue));
  } else if (command === "stop") {
    specRun.requestStop(specIssue);
    console.log("Stop requested; the run ends after its current ticket.");
  } else {
    const result = await specRun.run(specIssue);
    if (result.kind !== "finished") process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
