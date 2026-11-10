// The fixture and helpers SpecRun's test files share; each file calls useSpecRunHarness() once at its top.

import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";

import type { AgentStep } from "./AgentStep.ts";
import { batchEventFilePathOf } from "./BatchRecords.ts";
import type { ClonePaths } from "./clonePaths.ts";
import { EventFileNotices, type EventLine } from "./EventFileNotices.ts";
import type { WrapUpFacts } from "./FactsFile.ts";
import type { FakeAgentStep } from "./FakeAgentStep.ts";
import { FakeGitHub } from "./FakeGitHub.ts";
import { FakeNotices } from "./FakeNotices.ts";
import { FakeUsageReader } from "./FakeUsageReader.ts";
import { clonePathIn, git, GitFixture, rootCloneOnly } from "./GitFixture.ts";
import type { IssueRef, LeaseHolder } from "./IssueWorkspaces.ts";
import type { UsageList, UsageReader } from "./limitGuard.ts";
import type { NoticeKind, Notices } from "./Notices.ts";
import { stampedLineOf } from "./progressLines.ts";
import { type Command, runKnobsOf } from "./runKnobs.ts";
import { type MemberList, SpecRun, type SpecRunConfig } from "./SpecRun.ts";
import { stepResults } from "./specRunHarness/stepResults.ts";
import { timing } from "./specRunHarness/timing.ts";
import { trackedIssues } from "./specRunHarness/trackedIssues.ts";
import type { ResolveRecord } from "./stepRecords.ts";
import type { StepSession } from "./transcriptFacts.ts";
import { gapCheckOutputSchema } from "./Workflow/code/gapCheck.ts";

export type { StepScript } from "./specRunHarness/stepResults.ts";

export const {
  applied,
  blocked,
  capped,
  crashed,
  findingOf,
  greened,
  handoffResultOf,
  implemented,
  implementResultOf,
  noConversation,
  recordOf,
  resolved,
  resultOf,
  reviewed,
  throws,
} = stepResults;
export const { after, timed } = timing;

const everyClone = {
  "byro-repo": ".",
  "sheets-framework": "packages/framework",
};
export { rootCloneOnly };
export let clonePaths: ClonePaths;

export const spec: IssueRef = { repo: "byro-repo", number: 213 };
// The test runner's parent outlives every test, so it stands in for an interactive session's claude.
export const session: LeaseHolder = { kind: "session", pid: process.ppid };
// Small binaries, not node, since every run spawns them and a node process costs several times as much to start.
export const passes: Command = ["true"];
export const greenUnlessRed: Command = ["sh", "-c", "test ! -f RED"];

export let temp: string;
export let primaryRoot: string;
export let github: FakeGitHub;
export let notices: FakeNotices;
export let usageReader: UsageReader;

// The git fixture is built once per file and copied per test, since building it cost about 0.3s of each test.
export function useSpecRunHarness(clones: ClonePaths = everyClone): void {
  // Each run spawns real git over each clone, which a concurrent npm run check slows past the 5s default.
  vi.setConfig({ testTimeout: 15_000 });
  clonePaths = clones;
  let fixture: GitFixture;

  beforeAll(() => {
    fixture = GitFixture.init(clonePaths, {
      gitignoreOf: (repo) => (repo === "byro-repo" ? "packages/*\n" : ""),
    });
  });

  afterAll(() => {
    fixture.remove();
  });

  beforeEach(() => {
    temp = realpathSync(mkdtempSync(join(tmpdir(), "spec-run-")));
    primaryRoot = join(temp, "byro-repo");
    github = FakeGitHub.init();
    notices = FakeNotices.init();
    usageReader = FakeUsageReader.init(usageListOf(0.1, 0.2));
    fixture.copyTo(temp);
  });

  afterEach(() => {
    rmSync(temp, { recursive: true, force: true });
  });
}

export function scriptUsage(...lists: (UsageList | Error)[]): void {
  usageReader = FakeUsageReader.init(...lists);
}

// Account 2 is always idle, so a run on account 1 shows it reads only its own account; 1, the account runs launch on, is active by default.
export function usageListOf(
  fiveHour: number,
  sevenDay: number,
  activeAccount: number | undefined = 1,
): UsageList {
  const readings = [1, 2].map((account) => ({
    account,
    usage: {
      fiveHour: {
        utilization: account === 1 ? fiveHour : 0,
        resetsAt: new Date("2026-10-12T11:00:00Z"),
      },
      sevenDay: {
        utilization: account === 1 ? sevenDay : 0,
        resetsAt: new Date("2026-10-15T00:00:00Z"),
      },
    },
  }));
  return { readings, activeAccount };
}

export function refOf(number: number): IssueRef {
  return { repo: "byro-repo", number };
}

export function primaryOf(repo: keyof typeof everyClone): string {
  return join(primaryRoot, clonePathIn(clonePaths, repo));
}

export function commitRed(clone: string): void {
  stepResults.commitFile({
    cwd: clone,
    file: "RED",
    content: "",
    message: "Turn master red",
  });
}

export function bodyWith(pairLine = "Opus high"): string {
  return `## What to build\n\nA thing.\n\n## Model fit\n\n${pairLine}\nA reason.\n`;
}

export function bodyWithTargets(...targetLines: string[]): string {
  return `## What to build\n\nA thing.\n\n## Targets\n\n${targetLines.join("\n")}\n\n## Model fit\n\nOpus high\nA reason.\n`;
}

export function addIssue(
  number: number,
  {
    labels = ["ready-for-agent"],
    body = bodyWith(),
  }: { labels?: string[]; body?: string } = {},
): void {
  github.issues.set(number, trackedIssues.issueOf(number, { labels, body }));
}

export function addSpec(tickets: number[]): void {
  addIssue(spec.number, { labels: [], body: "## What to build\n\nA spec.\n" });
  github.edit(spec.number, { title: "The spec" });
  github.subIssues.set(spec.number, tickets);
  tickets.forEach((ticket) => addIssue(ticket));
}

export function masterSetPath(): string {
  return join(temp, "workspaces", "master-byro-repo-213");
}

export function stateFolder(): string {
  return join(temp, "state");
}

// A config override, plus the members an idle run's first poll requests a stop on.
export type SpecRunOverrides = Partial<SpecRunConfig> & {
  members?: IssueRef[];
};

// The gap check finds no gaps unless a test passes its own agentStep to script it; an idle run stops at its first poll,
// through a stop request on each of `members`, the spec unless a Batch test names its own.
export function specRun(
  agentStep: FakeAgentStep,
  { members = [spec], ...overrides }: SpecRunOverrides = {},
): SpecRun {
  const withGapCheck: AgentStep = {
    run: async (request) =>
      request.jsonSchema === gapCheckOutputSchema
        ? resultOf({ gaps: [] })
        : agentStep.run(request),
  };
  const knobs = runKnobsOf({
    clonePaths,
    checks: [greenUnlessRed],
    authChecks: [passes],
    runnerPaths: ["runner/", "scripts/runner/"],
  });
  const run = SpecRun.init({
    knobs,
    agentStep: withGapCheck,
    github,
    notices,
    usageReader,
    clock: { now: () => timing.startTime },
    githubOwner: "byronbroughten",
    developer: "byronbroughten",
    primaryRoot,
    workspaceFolder: join(temp, "workspaces"),
    symlinkedFiles: [],
    async installDependencies() {},
    promoteCommandOf: () => "npm run issue:promote -- byro-repo 1",
    removeCommand: "npm run issue:remove",
    mergeChecks: [greenUnlessRed],
    outcomeFolder: "docs/agents/outcomes",
    stateFolder: stateFolder(),
    configFolder: "/config/account-1",
    wrapUpKnobs: { backoffMs: 1, lockPollMs: 1 },
    async sleep(ms) {
      if (ms !== knobs.idlePollMs) return;
      members.forEach((member) => {
        run.requestStop(member);
      });
    },
    ...overrides,
  });
  return run;
}

export function haltComments(): string[] {
  return github.comments
    .map(({ body }) => body)
    .filter((body) => body.includes("**Halt H"));
}

export function commentsOn(number: number, mark: string): string[] {
  return github.comments
    .filter(({ issue }) => issue.number === number)
    .map(({ body }) => body)
    .filter((body) => body.includes(mark));
}

export function noticeKinds(): (NoticeKind | undefined)[] {
  return notices.sent.map(({ kind }) => kind);
}

export function noticeSummaries(): string[] {
  return notices.sent.map(({ summary }) => summary);
}

export function masterSubjects(): string[] {
  return git(primaryOf("byro-repo"), "log", "--format=%s", "master").split(
    "\n",
  );
}

// The spec's progress log unless another member is named, such as a Batch member's.
export function progressLines(number = spec.number): string[] {
  return readFileSync(join(stateFolder(), `byro-repo-${number}.log`), "utf8")
    .trimEnd()
    .split("\n");
}

export function eventOf(line: string): string {
  return stampedLineOf(line).text;
}

// The events a progress log gained after its first `count` lines.
export function progressEventsAfter(
  count: number,
  number = spec.number,
): string[] {
  return progressLines(number).slice(count).map(eventOf);
}

export function timingLines(): string[] {
  return progressLines()
    .map(eventOf)
    .filter((line) => / took |^Preflight passed|^Run started/.test(line));
}

interface SavedTicket {
  step: string;
  resolveRecords?: ResolveRecord[];
  sessions: StepSession[];
}

// The spec's run state unless another member is named, such as a Standalone one's.
export function runStatePath(number = spec.number): string {
  return join(stateFolder(), `byro-repo-${number}.run.json`);
}

// A config override that also writes the event files a Supervisor watches.
export function withEventFile(): Partial<SpecRunConfig> {
  const eventFile = EventFileNotices.init(
    stateFolder(),
    () => timing.startTime,
  );
  return { notices: composedNotices(notices, eventFile) };
}

function composedNotices(...adapters: Notices[]): Notices {
  return {
    async send(notice) {
      await Promise.all(adapters.map((adapter) => adapter.send(notice)));
    },
  };
}

export function batchEventLines(members: MemberList): EventLine[] {
  return readFileSync(batchEventFilePathOf(stateFolder(), members), "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as EventLine);
}

export function runLockPath(): string {
  return join(stateFolder(), "byro-repo-213.run.lock");
}

// A killed run's pid is dead, so a rerun takes its lock over; a run left hung in this process still holds it.
export function freeHungRunLock(): void {
  rmSync(runLockPath());
}

// Ticket 1's facts file unless another is named, such as a Standalone ticket's.
export function ticketFacts(number = 1): Partial<WrapUpFacts> {
  const path = join(stateFolder(), `byro-repo-${number}.facts.json`);
  return JSON.parse(readFileSync(path, "utf8")) as Partial<WrapUpFacts>;
}

export function ticketState(): Record<string, SavedTicket> {
  return (
    JSON.parse(readFileSync(runStatePath(), "utf8")) as {
      tickets: Record<string, SavedTicket>;
    }
  ).tickets;
}
