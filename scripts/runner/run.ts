// Runs a spec's tickets to landed, one at a time; rerunning the same command resumes. Progress is in .runner/<repo>-<n>.log.
// Usage: npm run runner -- [status|stop|review] <owner/repo> <n>. Exit 1 is a run that ended short of finished, or a review short of reviewed; 2 is a crash, which tmux.sh pushes.
// `review` takes a ticket, not a spec: an interactive session's review, triage and fix of its own ticket, outside any run.
import { SpecRun } from "@byronbroughten/spec-runner/SpecRun";

import { nearestClaudeAncestor } from "./claudeAncestor.ts";
import { specRunConfigOf } from "./runnerConfig.ts";

const usage = "Usage: npm run runner -- [status|stop|review] <owner/repo> <n>";
const verbs = ["status", "stop", "review"];

try {
  const args = process.argv.slice(2);
  let command = "run";
  if (verbs.includes(args[0] ?? "")) {
    command = args[0] ?? "";
    args.shift();
  }
  const [ownerRepo = "", number] = args;
  const [owner, repo] = ownerRepo.split("/");
  if (!owner || !repo || !Number.isInteger(Number(number))) {
    throw new Error(usage);
  }
  const issue = { repo, number: Number(number) };
  const specRun = SpecRun.init(specRunConfigOf(owner));
  if (command === "status") {
    console.log(await specRun.status(issue));
  } else if (command === "stop") {
    specRun.requestStop(issue);
    console.log("Stop requested.");
  } else if (command === "review") {
    const result = await specRun.review(issue, {
      holder: nearestClaudeAncestor(),
    });
    console.log([result.message, ...result.halts].join("\n\n"));
    if (result.kind !== "reviewed") process.exitCode = 1;
  } else {
    const result = await specRun.run(issue);
    if (result.kind !== "finished") process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
