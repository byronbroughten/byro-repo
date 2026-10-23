// Runs a spec's tickets to landed, one at a time; rerunning the same command resumes. Progress is in .runner/<repo>-<n>.log.
// Usage below; `review` and `resolve` take a session's ticket, not a spec, and `resolve` the path of the session's records.
// Exit 1 is a run short of finished, a review short of reviewed or its findings, or refused records; 2 is a crash, which tmux.sh pushes.
// `supervise` records the caller's claude as the spec's Supervisor and prints its unexplained event lines; `--advance` marks one more explained.
import { readFileSync } from "node:fs";

import {
  isSameIssue,
  type IssueRef,
} from "@byronbroughten/spec-runner/IssueWorkspaces";
import { reviewPrintoutOf, SpecRun } from "@byronbroughten/spec-runner/SpecRun";
import { SupervisionRecords } from "@byronbroughten/spec-runner/SupervisionRecords";

import { nearestClaudeAncestor } from "./claudeAncestor.ts";
import { ntfyTopic, specRunConfigOf, stateFolder } from "./runnerConfig.ts";

const plainVerbs = ["status", "stop", "review"];
const verbs = [...plainVerbs, "resolve", "supervise"];
const usage = `Usage: npm run runner -- [${plainVerbs.join("|")}] <owner/repo> <n>, resolve <owner/repo> <n> <records.json>, or supervise <owner/repo> <n> [--advance]`;

try {
  const args = process.argv.slice(2);
  let command = "run";
  if (verbs.includes(args[0] ?? "")) {
    command = args[0] ?? "";
    args.shift();
  }
  const [ownerRepo = "", number, flag] = args;
  const [owner, repo] = ownerRepo.split("/");
  const isAdvance = flag === "--advance";
  const isFlagValid =
    command === "resolve"
      ? flag !== undefined
      : flag === undefined || (command === "supervise" && isAdvance);
  if (!owner || !repo || !Number.isInteger(Number(number)) || !isFlagValid) {
    throw new Error(usage);
  }
  const issue = { repo, number: Number(number) };
  if (command === "supervise") {
    await supervise(owner, issue, isAdvance);
  } else {
    await runSpec(command, owner, issue, flag);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}

async function runSpec(
  command: string,
  owner: string,
  issue: IssueRef,
  recordsPath: string | undefined,
): Promise<void> {
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
    console.log(reviewPrintoutOf(result));
    if (result.kind !== "reviewed" && result.kind !== "findings") {
      process.exitCode = 1;
    }
  } else if (command === "resolve") {
    if (recordsPath === undefined) throw new Error(usage);
    const result = await specRun.resolve(issue, {
      holder: nearestClaudeAncestor(),
      output: JSON.parse(readFileSync(recordsPath, "utf8")),
    });
    console.log(reviewPrintoutOf(result));
    if (result.kind !== "reviewed") process.exitCode = 1;
  } else {
    // Only a run sends notices, so only a run needs the topic before it starts.
    ntfyTopic();
    const result = await specRun.run(issue);
    if (result.kind !== "finished") process.exitCode = 1;
  }
}

async function supervise(
  owner: string,
  spec: IssueRef,
  isAdvance: boolean,
): Promise<void> {
  const holder = nearestClaudeAncestor();
  if (!holder) throw new Error("supervise runs only under a claude session.");
  const records = SupervisionRecords.init(stateFolder);
  if (isAdvance) {
    const record = await records.recordOf(holder);
    if (record === undefined || !isSameIssue(record.spec, spec)) {
      throw new Error(
        `This session doesn't supervise ${ownerRepoOf(owner, spec)}.`,
      );
    }
    await records.advance(holder);
    return;
  }
  await records.supervise(holder, owner, spec);
  for (const line of await records.unexplainedLinesOf(holder)) {
    console.log(line);
  }
}

function ownerRepoOf(owner: string, { repo, number }: IssueRef): string {
  return `${owner}/${repo} ${number}`;
}
