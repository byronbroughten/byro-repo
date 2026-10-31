// Runs a spec's tickets to landed, one at a time, or a Batch's given several numbers; rerunning the same command resumes. Progress is in .runner/<repo>-<n>.log.
// Usage below; every verb but the run itself takes one number, a Batch's any member's. `review` and `resolve` take a session's ticket, not a spec, and `resolve` the path of the session's records.
// Exit 1 is a run short of finished, a review short of reviewed or its findings, or refused records; 2 is a crash, which tmux.sh pushes;
// 3 is a Restart, which tmux.sh relaunches.
// `supervise` records the caller's claude as the spec's or Batch's Supervisor and prints its unexplained event lines; `--advance` marks one more explained.
// `watch` streams the spec's or Batch's new event lines and prints a `vanished` line if the run's process dies unreported (runWatch.ts);
// `--once` prints the first unexplained line, or that `vanished` line, and exits, or exits silently once a newer watch replaces it.
// `status` and `watch` with no spec print the Run board once or redraw it every 5s (runBoard.ts).
// `decide` ticks one review-list item and adds its `Decided:` line, or with `--handled` adds a `Handled:` line unticked (SpecRun/ReviewItemDecider.ts).
// `judgeable` lists the repo's open issues with undecided review-list items or ready to close, for /judge-findings (SpecRun/JudgeableIssueLister.ts).
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import { BatchRecords } from "@byronbroughten/spec-runner/BatchRecords";
import { type IssueRef } from "@byronbroughten/spec-runner/IssueWorkspaces";
import { isItemId } from "@byronbroughten/spec-runner/reviewList";
import { runBoardOf, watchBoard } from "@byronbroughten/spec-runner/runBoard";
import { RunLock } from "@byronbroughten/spec-runner/RunLock";
import { reviewPrintoutOf, SpecRun } from "@byronbroughten/spec-runner/SpecRun";
import {
  isWatching,
  SupervisionRecords,
} from "@byronbroughten/spec-runner/SupervisionRecords";

import { nearestClaudeAncestor } from "./claudeAncestor.ts";
import { launchArgsOf } from "./launchArgs.ts";
import { specRunConfigOf, stateFolder } from "./runnerConfig.ts";
import { type WatchDeps, watchOnce, watchRun } from "./runWatch.ts";

// tmux.sh pushes a crash and relaunches only on a restart.
const exitCodes = { short: 1, crash: 2, restart: 3 } as const;
const plainVerbs = ["status", "stop", "review"];
const boardVerbs = ["status", "watch"];
const verbs = [
  ...plainVerbs,
  "watch",
  "resolve",
  "supervise",
  "decide",
  "judgeable",
];
const usage = `Usage: npm run runner -- <owner/repo> <n> [<n>…] to run one spec or a Batch, ${plainVerbs.join("|")} <owner/repo> <n>, watch <owner/repo> <n> [--once], resolve <owner/repo> <n> <records.json>, supervise <owner/repo> <n> [--advance], decide <owner/repo> <spec> R<n>.<k> [--handled] "<text>", judgeable <owner/repo>, or [${boardVerbs.join("|")}] alone for the Run board`;

try {
  const args = process.argv.slice(2);
  let command = "run";
  if (verbs.includes(args[0] ?? "")) {
    command = args[0] ?? "";
    args.shift();
  }
  if (args.length === 0 && boardVerbs.includes(command)) {
    await showBoard(command);
  } else if (command === "decide") {
    await decide(args);
  } else if (command === "judgeable") {
    await listJudgeable(args);
  } else if (command === "run") {
    await runBatch(args);
  } else {
    await runOnSpec(command, args);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = exitCodes.crash;
}

async function showBoard(command: string): Promise<void> {
  if (command === "status") {
    console.log(boardNow());
    return;
  }
  await watchBoard({
    render: boardNow,
    draw: (board) => {
      console.clear();
      console.log(board);
    },
    pollMs: 5_000,
    sleep,
  });
}

function boardNow(): string {
  return runBoardOf(stateFolder, new Date());
}

interface SpecArgs {
  owner: string;
  issue: IssueRef;
}

interface RepoArgs {
  owner: string;
  repo: string;
}

// Throws the usage for anything but `<owner/repo>`.
function repoArgsOf(ownerRepo: string): RepoArgs {
  const [owner, repo] = ownerRepo.split("/");
  if (!owner || !repo) throw new Error(usage);
  return { owner, repo };
}

// Throws the usage for anything but `<owner/repo> <n>`.
function specArgsOf(ownerRepo: string, number: string | undefined): SpecArgs {
  const { owner, repo } = repoArgsOf(ownerRepo);
  if (!Number.isInteger(Number(number))) throw new Error(usage);
  return { owner, issue: { repo, number: Number(number) } };
}

async function runOnSpec(command: string, args: string[]): Promise<void> {
  const [ownerRepo = "", number, flag] = args;
  const { owner, issue } = specArgsOf(ownerRepo, number);
  const isAdvance = flag === "--advance";
  const isOnce = flag === "--once";
  const isFlagValid =
    command === "resolve"
      ? flag !== undefined
      : flag === undefined ||
        (command === "supervise" && isAdvance) ||
        (command === "watch" && isOnce);
  if (!isFlagValid) throw new Error(usage);
  if (command === "supervise") {
    await supervise(owner, issue, isAdvance);
  } else if (command === "watch" && isOnce) {
    await watchOnce(
      { owner, spec: issue },
      {
        ...watchDepsOf(),
        records: SupervisionRecords.init(stateFolder),
        pid: process.pid,
      },
    );
  } else if (command === "watch") {
    const members = BatchRecords.init(stateFolder).membersOf(issue);
    await watchRun({ owner, members }, watchDepsOf());
  } else {
    await runSpec(command, owner, issue, flag);
  }
}

// A watch's run is live while any member's run lock is held.
function watchDepsOf(): WatchDeps {
  return {
    stateFolder,
    pollMs: 3_000,
    isRunLive: (members) =>
      members.some((member) => RunLock.isHeld(stateFolder, member)),
    now: () => new Date(),
    sleep,
    print: (line: string) => console.log(line),
  };
}

// Several numbers run one Batch; a Restart reruns the same list (tmux.sh).
async function runBatch(args: string[]): Promise<void> {
  const launch = launchArgsOf(args);
  if (launch === undefined) throw new Error(usage);
  const specRun = SpecRun.init(specRunConfigOf(launch.owner));
  const result = await specRun.run(...launch.members);
  if (result.kind === "restarting") {
    process.exitCode = exitCodes.restart;
  } else if (result.kind !== "finished") {
    process.exitCode = exitCodes.short;
  }
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
      process.exitCode = exitCodes.short;
    }
  } else if (command === "resolve") {
    if (recordsPath === undefined) throw new Error(usage);
    const result = await specRun.resolve(issue, {
      holder: nearestClaudeAncestor(),
      output: JSON.parse(readFileSync(recordsPath, "utf8")),
    });
    console.log(reviewPrintoutOf(result));
    if (result.kind !== "reviewed") process.exitCode = exitCodes.short;
  } else {
    throw new Error(usage);
  }
}

// `--handled` may sit anywhere after the item id.
async function decide(args: string[]): Promise<void> {
  const [ownerRepo = "", number, itemId, ...rest] = args;
  const { owner, issue } = specArgsOf(ownerRepo, number);
  const isHandled = rest.includes("--handled");
  const texts = rest.filter((arg) => arg !== "--handled");
  const [text] = texts;
  if (
    itemId === undefined ||
    !isItemId(itemId) ||
    texts.length !== 1 ||
    !text
  ) {
    throw new Error(usage);
  }
  const specRun = SpecRun.init(specRunConfigOf(owner));
  console.log(
    await specRun.decide(issue, {
      itemId,
      kind: isHandled ? "handled" : "decided",
      text,
    }),
  );
}

async function listJudgeable(args: string[]): Promise<void> {
  const [ownerRepo = "", ...rest] = args;
  const { owner, repo } = repoArgsOf(ownerRepo);
  if (rest.length > 0) throw new Error(usage);
  const specRun = SpecRun.init(specRunConfigOf(owner));
  console.log(await specRun.judgeable(repo));
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
    if (record === undefined || !isWatching(record, spec)) {
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
