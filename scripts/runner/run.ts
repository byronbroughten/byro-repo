// Runs a spec's tickets to landed, one at a time, or a Batch's given several numbers; rerunning the same command resumes. Progress is in .runner/<repo>-<n>.log.
// Usage below; each `<repo>` is a bare name the repo map holds, as issue:start takes, or `<owner>/<repo>`. Every verb but the run itself and `open` takes one number, a Batch's any member's. `review` and `resolve` take a session's ticket, not a spec, and `resolve` the path of the session's records.
// `review` alone prints the review brief and records its start; with the session's review record and `--session <id>` it submits the review (SpecRun/SessionReviewer.ts).
// Exit 1 is a run short of finished, a review short of its brief, reviewed or its findings, or refused records; 2 is a crash, which tmux.sh pushes;
// 3 is a Restart, which tmux.sh relaunches.
// `open` launches its numbers through tmux.sh when no run is live, or rejoins a live run or a live Batch holding one, then catches up as `supervise` does (SpecRun/RunOpener.ts); exit 1 is a launch whose run never started.
// `supervise` records the caller's claude as the spec's or Batch's Supervisor and prints its unexplained event lines, after the last Supervisor's handoff on a rejoin; `--advance` marks one more explained.
// `watch` streams the spec's or Batch's new event lines and prints a `vanished` line if the run's process dies unreported (runWatch.ts);
// `--once` prints the first unexplained line, or that `vanished` line, and exits, or exits silently once a newer watch replaces it.
// `status` and `watch` with no spec print the Run board once or redraw it every 5s, reading accounts every 60s (runBoard.ts).
// `decide` ticks one review-list item and adds its `Decided:` line, or with `--handled` adds a `Handled:` line unticked (SpecRun/ReviewItemDecider.ts).
// `judgeable` lists the repo's open issues with undecided review-list items or ready to close, for /judge-findings (SpecRun/JudgeableIssueLister.ts).
// `judge-brief` prints all /judge-findings' step 1 reads for each spec named, `all` taking `judgeable`'s list in place; it exits 0 on every outcome, a refusal included, since the skill injects it (SpecRun/JudgeBriefWriter.ts).
// `standalone` lists the repo's launchable Standalone tickets, the left-out ones with their reasons, and the line that launches the list; nothing launches (SpecRun/StandaloneTicketLister.ts).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { AccountLease } from "@byronbroughten/spec-runner/AccountLease";
import { AccountsSection } from "@byronbroughten/spec-runner/AccountsSection";
import { BatchRecords } from "@byronbroughten/spec-runner/BatchRecords";
import { CswapUsageReader } from "@byronbroughten/spec-runner/CswapUsageReader";
import {
  type IssueRef,
  type LeaseHolder,
} from "@byronbroughten/spec-runner/IssueWorkspaces";
import { isStillRunning } from "@byronbroughten/spec-runner/processIdentity";
import { isItemId } from "@byronbroughten/spec-runner/reviewList";
import {
  boardTimings,
  runBoardOf,
  watchBoard,
} from "@byronbroughten/spec-runner/runBoard";
import { runCollecting } from "@byronbroughten/spec-runner/runCollecting";
import { RunLock } from "@byronbroughten/spec-runner/RunLock";
import {
  handoffBlockOf,
  type JudgedSpecs,
  type LaunchReport,
  type MemberList,
  reviewPrintoutOf,
  type ReviewResult,
  type RunLauncher,
  SpecRun,
} from "@byronbroughten/spec-runner/SpecRun";
import {
  isWatching,
  SupervisionRecords,
} from "@byronbroughten/spec-runner/SupervisionRecords";
import { configFolderOf } from "@byronbroughten/spec-runner/transcriptFacts";

import { nearestClaudeAncestor } from "./claudeAncestor.ts";
import { activeAccount } from "./cswapAccount.ts";
import { launchArgsOf, type RepoArgs, repoArgsOf } from "./launchArgs.ts";
import { repoMap, specRunConfigOf, stateFolder } from "./runnerConfig.ts";
import { type WatchDeps, watchOnce, watchRun } from "./runWatch.ts";

// tmux.sh writes a crash's run-ended line and relaunches only on a restart.
const exitCodes = { short: 1, crash: 2, restart: 3 } as const;
const plainVerbs = ["status", "stop"];
const boardVerbs = ["status", "watch"];
// Each verb that takes only `<repo>` and prints what its SpecRun method resolves to.
const repoListers = {
  judgeable(specRun: SpecRun, repo: string): Promise<string> {
    return specRun.judgeable(repo);
  },
  standalone(specRun: SpecRun, repo: string): Promise<string> {
    return specRun.standalone(repo);
  },
} as const;
type RepoVerb = keyof typeof repoListers;
const repoVerbs = Object.keys(repoListers);
const verbs = [
  ...plainVerbs,
  "watch",
  "open",
  "review",
  "resolve",
  "supervise",
  "decide",
  "judge-brief",
  ...repoVerbs,
];
const judgeBriefUsage = "judge-brief <repo> <spec>…|all";
const usage = `Usage: npm run runner -- <repo> <n> [<n>…] to run one spec or a Batch, ${plainVerbs.join("|")} <repo> <n>, watch <repo> <n> [--once], open <repo> <n> [<n>…], review <repo> <n> [<review.json> --session <id>], resolve <repo> <n> <records.json>, supervise <repo> <n> [--advance], decide <repo> <spec> R<n>.<k> [--handled] "<text>", ${judgeBriefUsage}, ${repoVerbs.join("|")} <repo>, or [${boardVerbs.join("|")}] alone for the Run board; each <repo> also takes <owner>/<repo>`;

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
  } else if (command === "review") {
    await review(args);
  } else if (command === "judge-brief") {
    await judgeBrief(args);
  } else if (isRepoVerb(command)) {
    await listForRepo(command, args);
  } else if (command === "run") {
    await runBatch(args);
  } else if (command === "open") {
    await open(args);
  } else {
    await runOnSpec(command, args);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = exitCodes.crash;
}

async function showBoard(command: string): Promise<void> {
  if (command === "status") {
    console.log(await boardNow(accountsSectionOf(undefined)));
    return;
  }
  const accounts = accountsSectionOf(boardTimings.accountsRefreshMs);
  await watchBoard({
    render: () => boardNow(accounts),
    draw: (board) => {
      console.clear();
      console.log(board);
    },
    pollMs: boardTimings.redrawMs,
    sleep,
  });
}

function accountsSectionOf(refreshMs: number | undefined): AccountsSection {
  return AccountsSection.init({
    usageReader: CswapUsageReader.init(),
    leaseReader: AccountLease.readerOf(stateFolder),
    refreshMs,
  });
}

function boardNow(accounts: AccountsSection): Promise<string> {
  return runBoardOf({ stateFolder, accounts, now: new Date() });
}

interface SpecArgs {
  owner: string;
  issue: IssueRef;
}

// Throws the usage for anything but `<repo>` the repo map holds or `<owner>/<repo>`.
function requiredRepoArgsOf(repoName: string): RepoArgs {
  const repoArgs = repoArgsOf(repoName, repoMap);
  if (repoArgs === undefined) throw new Error(usage);
  return repoArgs;
}

// Throws the usage for anything but `<repo> <n>` or `<owner>/<repo> <n>`.
function specArgsOf(repoName: string, number: string | undefined): SpecArgs {
  const { owner, repo } = requiredRepoArgsOf(repoName);
  if (!Number.isInteger(Number(number))) throw new Error(usage);
  return { owner, issue: { repo, number: Number(number) } };
}

async function runOnSpec(command: string, args: string[]): Promise<void> {
  const [repoName = "", number, flag] = args;
  const { owner, issue } = specArgsOf(repoName, number);
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
        isProcessLive: isStillRunning,
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
    isRunLive: (members) => RunLock.isAnyHeld(stateFolder, members),
    now: () => new Date(),
    sleep,
    print: (line: string) => console.log(line),
  };
}

// Several numbers run one Batch; a Restart reruns the same list (tmux.sh).
async function runBatch(args: string[]): Promise<void> {
  const launch = launchArgsOf(args, repoMap);
  if (launch === undefined) throw new Error(usage);
  const specRun = SpecRun.init(specRunConfigOf(launch.owner));
  const result = await specRun.run(...launch.members);
  if (result.kind === "restarting") {
    process.exitCode = exitCodes.restart;
  } else if (result.kind !== "finished") {
    process.exitCode = exitCodes.short;
  }
}

async function open(args: string[]): Promise<void> {
  const launch = launchArgsOf(args, repoMap);
  if (launch === undefined) throw new Error(usage);
  const specRun = SpecRun.init(specRunConfigOf(launch.owner));
  const result = await specRun.open(launch.members, {
    holder: requiredClaudeAncestor("open"),
    launcher: tmuxLauncherOf(launch.owner),
  });
  console.log(result.text);
  if (!result.isLive) process.exitCode = exitCodes.short;
}

// tmux.sh itself launches, so its attach line, dead-session replacement and launchWait stay in one place.
function tmuxLauncherOf(owner: string): RunLauncher {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  return {
    async launch(members: MemberList): Promise<LaunchReport> {
      const [{ repo }] = members;
      const numbers = members.map(({ number }) => String(number));
      const { isOk, output } = await runCollecting(
        "bash",
        [join(root, "scripts/runner/tmux.sh"), `${owner}/${repo}`, ...numbers],
        { cwd: root },
      );
      return { text: output, isStarted: isOk };
    },
  };
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

// The submit's account and config folder are this process's, which the session that runs it shares.
async function review(args: string[]): Promise<void> {
  const [repoName = "", number, recordPath, flag, sessionId, ...rest] = args;
  const { owner, issue } = specArgsOf(repoName, number);
  const specRun = SpecRun.init(specRunConfigOf(owner));
  const holder = nearestClaudeAncestor();
  let result: ReviewResult;
  if (recordPath === undefined) {
    result = await specRun.briefReview(issue, { holder });
  } else {
    if (flag !== "--session" || !sessionId || rest.length > 0) {
      throw new Error(usage);
    }
    result = await specRun.submitReview(issue, {
      holder,
      output: JSON.parse(readFileSync(recordPath, "utf8")),
      session: {
        sessionId,
        configFolder: configFolderOf(process.env, homedir()),
        account: activeAccount(),
      },
    });
  }
  console.log(reviewPrintoutOf(result));
  const passedKinds: ReviewResult["kind"][] = ["brief", "reviewed", "findings"];
  if (!passedKinds.includes(result.kind)) process.exitCode = exitCodes.short;
}

// `--handled` may sit anywhere after the item id.
async function decide(args: string[]): Promise<void> {
  const [repoName = "", number, itemId, ...rest] = args;
  const { owner, issue } = specArgsOf(repoName, number);
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

// Injected into /judge-findings, so every refusal is its own line with exit 0, never the usage and a crash.
async function judgeBrief(args: string[]): Promise<void> {
  const [repoName = "", ...named] = args;
  const repoArgs = repoArgsOf(repoName, repoMap);
  if (repoArgs === undefined) {
    console.log(
      `No judge brief: "${repoName}" is neither a repo the repo map holds nor <owner>/<repo>. Run ${judgeBriefUsage}.`,
    );
    return;
  }
  const specs = judgedSpecsOf(named);
  if (specs === undefined) {
    console.log(
      `No judge brief: name one or more spec numbers or \`all\`, not "${named.join(" ")}". Run ${judgeBriefUsage}.`,
    );
    return;
  }
  const specRun = SpecRun.init(specRunConfigOf(repoArgs.owner));
  console.log(await specRun.judgeBrief(repoArgs.repo, specs));
}

// Undefined unless every argument is a positive whole number or `all`.
function judgedSpecsOf(named: string[]): JudgedSpecs | undefined {
  if (named.length === 0) return undefined;
  const specs = named.flatMap((arg): JudgedSpecs => {
    if (arg === "all") return ["all"];
    const number = Number(arg);
    return Number.isInteger(number) && number > 0 ? [number] : [];
  });
  return specs.length === named.length ? specs : undefined;
}

function isRepoVerb(command: string): command is RepoVerb {
  return repoVerbs.includes(command);
}

async function listForRepo(command: RepoVerb, args: string[]): Promise<void> {
  const [repoName = "", ...rest] = args;
  const { owner, repo } = requiredRepoArgsOf(repoName);
  if (rest.length > 0) throw new Error(usage);
  const specRun = SpecRun.init(specRunConfigOf(owner));
  console.log(await repoListers[command](specRun, repo));
}

async function supervise(
  owner: string,
  spec: IssueRef,
  isAdvance: boolean,
): Promise<void> {
  const holder = requiredClaudeAncestor("supervise");
  if (isAdvance) {
    const records = SupervisionRecords.init(stateFolder);
    const record = await records.recordOf(holder);
    if (record === undefined || !isWatching(record, spec)) {
      throw new Error(
        `This session doesn't supervise ${ownerRepoOf(owner, spec)}.`,
      );
    }
    await records.advance(holder);
    return;
  }
  const specRun = SpecRun.init(specRunConfigOf(owner));
  const { handoff, unexplainedLines } = await specRun.catchUp(holder, spec);
  if (handoff !== undefined) console.log(`${handoffBlockOf(handoff)}\n`);
  for (const line of unexplainedLines) {
    console.log(line);
  }
}

function requiredClaudeAncestor(command: string): LeaseHolder {
  const holder = nearestClaudeAncestor();
  if (!holder) throw new Error(`${command} runs only under a claude session.`);
  return holder;
}

function ownerRepoOf(owner: string, { repo, number }: IssueRef): string {
  return `${owner}/${repo} ${number}`;
}
