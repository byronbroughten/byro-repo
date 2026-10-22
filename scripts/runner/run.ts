// Runs a spec's tickets to landed, one at a time; rerunning the same command resumes. Progress is in .runner/<repo>-<n>.log.
// Usage below; `review` takes a session's ticket, not a spec. Exit 1 is a run short of finished or a review short of reviewed; 2 is a crash, which tmux.sh pushes.
import { SpecRun } from "@byronbroughten/spec-runner/SpecRun";

import { nearestClaudeAncestor } from "./claudeAncestor.ts";
import { specRunConfigOf } from "./runnerConfig.ts";

const verbs = ["status", "stop", "review"];
const usage = `Usage: npm run runner -- [${verbs.join("|")}] <owner/repo> <n>`;

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
