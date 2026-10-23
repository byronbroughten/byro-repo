// The fixture and helpers SpecRun's test files share; each file calls useSpecRunHarness() once at its top.

import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";

import type { AgentStep, StepRequest, StepResult } from "./AgentStep.ts";
import type { WrapUpFacts } from "./FactsFile.ts";
import type { FakeAgentStep, ScriptedStep } from "./FakeAgentStep.ts";
import { FakeGitHub } from "./FakeGitHub.ts";
import { FakeNotices } from "./FakeNotices.ts";
import { FakeUsageReader } from "./FakeUsageReader.ts";
import type { TriageRecord } from "./findingTriage.ts";
import { gapCheckOutputSchema } from "./gapCheck.ts";
import { git, GitFixture } from "./GitFixture.ts";
import type { Blocker, Handoff, ImplementRecord } from "./implementStep.ts";
import type { IssueRef } from "./IssueWorkspaces.ts";
import type { AccountReading, UsageReader } from "./limitGuard.ts";
import type { Notice } from "./Notices.ts";
import type { ReviewFinding } from "./reviewStep.ts";
import { type Command, runKnobsOf } from "./runKnobs.ts";
import { SpecRun, type SpecRunConfig } from "./SpecRun.ts";
import type { StepSession } from "./transcriptFacts.ts";

export const clonePaths = {
  "byro-repo": ".",
  "sheets-framework": "packages/framework",
};

export const spec: IssueRef = { repo: "byro-repo", number: 213 };
export const passes: Command = ["node", "-e", "process.exit(0)"];
export const greenUnlessRed: Command = [
  "node",
  "-e",
  "process.exit(require('fs').existsSync('RED') ? 1 : 0)",
];

export let temp: string;
export let primaryRoot: string;
export let github: FakeGitHub;
export let notices: FakeNotices;
export let usageReader: UsageReader;

// The git fixture is built once per file and copied per test, since building it cost about 0.3s of each test.
export function useSpecRunHarness(): void {
  // Each run spawns real git over five repos, which a concurrent npm run check slows past the 5s default.
  vi.setConfig({ testTimeout: 15_000 });
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
    usageReader = FakeUsageReader.init(readingOf(0.1, 0.2));
    fixture.copyTo(temp);
  });

  afterEach(() => {
    rmSync(temp, { recursive: true, force: true });
  });
}

export function scriptUsage(...readings: (AccountReading[] | Error)[]): void {
  usageReader = FakeUsageReader.init(...readings);
}

// Account 2 is always idle, so a run on account 1 shows it reads only its own account.
export function readingOf(
  fiveHour: number,
  sevenDay: number,
): AccountReading[] {
  return [1, 2].map((account) => ({
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
}

export function refOf(number: number): IssueRef {
  return { repo: "byro-repo", number };
}

export function primaryOf(repo: keyof typeof clonePaths): string {
  return join(primaryRoot, clonePaths[repo]);
}

export function commitRed(clone: string): void {
  writeFileSync(join(clone, "RED"), "");
  git(clone, "add", "RED");
  git(clone, "commit", "-m", "Turn master red");
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
  github.issues.set(number, {
    issue: refOf(number),
    title: `Ticket ${number}`,
    body,
    isOpen: true,
    labels,
    url: `https://github.com/byronbroughten/byro-repo/issues/${number}`,
    author: "byronbroughten",
    bodyEditors: [],
  });
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

// The gap check finds no gaps unless a test passes its own agentStep to script it; an idle run stops at its first poll.
export function specRun(
  agentStep: FakeAgentStep,
  overrides: Partial<SpecRunConfig> = {},
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
  });
  const run = SpecRun.init({
    knobs,
    agentStep: withGapCheck,
    github,
    notices,
    usageReader,
    clock: { now: () => new Date("2026-10-12T09:00:00Z") },
    githubOwner: "byronbroughten",
    developer: "byronbroughten",
    primaryRoot,
    workspaceFolder: join(temp, "workspaces"),
    symlinkedFiles: [],
    async installDependencies() {},
    promoteCommandOf: () => "npm run issue:promote -- byro-repo 1",
    outcomeFolder: "docs/agents/outcomes",
    stateFolder: stateFolder(),
    wrapUpKnobs: { backoffMs: 1, lockPollMs: 1 },
    async sleep(ms) {
      if (ms === knobs.idlePollMs) run.requestStop(spec);
    },
    ...overrides,
  });
  return run;
}

export function resultOf(record: unknown): StepResult {
  return {
    output: { status: "valid", record },
    sessionId: "session",
    account: 1,
    configFolder: undefined,
    transcriptPath: undefined,
    peakContext: undefined,
    hasCrossedCeiling: false,
    hang: undefined,
    exitSubtype: "success",
    errorText: undefined,
    usage: undefined,
    limitHit: undefined,
  };
}

// An implement step's structured output carries its record under `record`.
export function implementResultOf(record: ImplementRecord): StepResult {
  return resultOf({ record });
}

// A handoff record commits nothing, so it names no branch.
export function handoffResultOf(handoff: Handoff): StepResult {
  return implementResultOf({
    status: "handoff",
    branches: [],
    closingComment: "",
    boxesUndone: [],
    blockers: [],
    handoff,
  });
}

export function recordOf(
  branch: string,
  sha: string,
  change: Partial<ImplementRecord> = {},
): ImplementRecord {
  return {
    status: "committed",
    branches: [{ repo: "byro-repo", branch, sha }],
    closingComment: "Landed it.",
    boxesUndone: [],
    blockers: [],
    ...change,
  } as ImplementRecord;
}

export type StepScript = (request: StepRequest) => Promise<StepResult>;

export const crashed: StepResult = {
  ...resultOf(undefined),
  output: { status: "none" },
  sessionId: "crashed-session",
  exitSubtype: "error_during_execution",
};

export const capped: StepResult = {
  ...resultOf(undefined),
  output: { status: "none" },
  sessionId: "capped-session",
  exitSubtype: "error_max_turns",
};

// The adapter itself throws, so the step never starts.
export function throws(message: string): StepScript {
  return async () => {
    throw new Error(message);
  };
}

// Commits `file` on the ticket's branch in the workspace, as a real implement step would.
export function implemented(
  file: string,
  { content = "export {};\n", act = () => {} } = {},
): StepScript {
  return async (request: StepRequest) => {
    act();
    writeFileSync(join(request.cwd, file), content);
    git(request.cwd, "add", file);
    git(request.cwd, "commit", "-m", `Add ${file}`);
    const branch = git(request.cwd, "branch", "--show-current");
    return implementResultOf(
      recordOf(branch, git(request.cwd, "rev-parse", "HEAD")),
    );
  };
}

// Commits nothing and returns a blocked record, as an implementer stuck before its first commit would.
export function blocked(
  blockers: Blocker[],
  facts: Partial<StepResult> = {},
): StepScript {
  return async (request: StepRequest) => ({
    ...implementResultOf(
      recordOf(git(request.cwd, "branch", "--show-current"), "", {
        status: "blocked",
        blockers,
      }),
    ),
    sessionId: "implement-session",
    peakContext: 90_000,
    ...facts,
  });
}

// Makes only GitHub writes and commits nothing, as an implement step on a ticket with no code would.
export function applied(): StepResult {
  return implementResultOf({
    status: "applied",
    branches: [],
    githubWrites: [
      {
        issue: "byronbroughten/byro-repo#213",
        action: "comment",
        url: "https://github.com/byronbroughten/byro-repo/issues/213#issuecomment-1",
        summary: "Posted the addendum.",
      },
    ],
    closingComment: "Posted the addendum.",
    boxesUndone: [],
    blockers: [],
  });
}

// Removes the committed RED file, as a red-checks step that turns the checks green would.
export function greened(): StepScript {
  return async (request) => {
    git(request.cwd, "rm", "-q", "RED");
    git(request.cwd, "commit", "-m", "Remove RED");
    return resultOf({ summary: "Removed RED." });
  };
}

export function reviewed(findings: ReviewFinding[] = []): StepResult {
  return resultOf({ findings });
}

// Finding `line` of one.ts, as a reviewer on `axis` reports it.
export function findingOf(
  line: number,
  axis: ReviewFinding["axis"] = "standards",
  suggestedVerdict: ReviewFinding["suggestedVerdict"] = "fix",
): ReviewFinding {
  return {
    axis,
    where: `one.ts:${line}`,
    claim: `Line ${line} is wrong.`,
    suggestedVerdict,
    reason: "It breaks a rule.",
  };
}

// Commits `fixFile`, as a resolver landing its Fix verdicts would, and returns the records.
export function resolved(
  records: TriageRecord[],
  fixFile?: string,
): StepScript {
  return async (request) => {
    if (fixFile !== undefined) {
      writeFileSync(join(request.cwd, fixFile), "export {};\n");
      git(request.cwd, "add", fixFile);
      git(request.cwd, "commit", "-m", `Fix ${fixFile}`);
    }
    return resultOf({ records });
  };
}

export function haltComments(): string[] {
  return github.comments
    .map(({ body }) => body)
    .filter((body) => body.includes("**Halt H"));
}

// The notices the ntfy adapter pushes, with the three fields it sends.
export function ntfyNotices(): Pick<
  Notice,
  "specTitle" | "summary" | "link"
>[] {
  return notices.sent
    .filter(({ kind }) => kind !== "refused")
    .map(({ specTitle, summary, link }) => ({ specTitle, summary, link }));
}

export function noticeSummaries(): string[] {
  return notices.sent.map(({ summary }) => summary);
}

export function masterSubjects(): string[] {
  return git(primaryOf("byro-repo"), "log", "--format=%s", "master").split(
    "\n",
  );
}

export function progressLines(): string[] {
  return readFileSync(join(stateFolder(), "byro-repo-213.log"), "utf8")
    .trimEnd()
    .split("\n");
}

const timestampLength = "2026-10-12T09:00:00.000Z ".length;

export function eventOf(line: string): string {
  return line.slice(timestampLength);
}

let time: number;

function advance(seconds: number): void {
  time += seconds * 1000;
}

// A clock the fakes move on; each workspace build installs dependencies in 4s.
export function timed(): Partial<SpecRunConfig> {
  time = new Date("2026-10-12T09:00:00Z").getTime();
  return {
    clock: { now: () => new Date(time) },
    async installDependencies() {
      advance(4);
    },
  };
}

export function after(seconds: number, step: ScriptedStep): StepScript {
  return async (request) => {
    advance(seconds);
    return typeof step === "function" ? step(request) : step;
  };
}

export function timingLines(): string[] {
  return progressLines()
    .map(eventOf)
    .filter((line) => / took |^Preflight passed|^Run started/.test(line));
}

interface SavedTicket {
  step: string;
  triage?: TriageRecord[];
  sessions: StepSession[];
}

export function runStatePath(): string {
  return join(stateFolder(), "byro-repo-213.run.json");
}

// Ticket 1's facts file.
export function ticketFacts(): Partial<WrapUpFacts> {
  const path = join(stateFolder(), "byro-repo-1.facts.json");
  return JSON.parse(readFileSync(path, "utf8")) as Partial<WrapUpFacts>;
}

export function ticketState(): Record<string, SavedTicket> {
  return (
    JSON.parse(readFileSync(runStatePath(), "utf8")) as {
      tickets: Record<string, SavedTicket>;
    }
  ).tickets;
}
