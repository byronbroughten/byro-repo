import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { StepRequest, StepResult } from "./AgentStep.ts";
import { FakeAgentStep, type ScriptedStep } from "./FakeAgentStep.ts";
import { FakeGitHub } from "./FakeGitHub.ts";
import { FakeNotices } from "./FakeNotices.ts";
import { FakeUsageReader } from "./FakeUsageReader.ts";
import {
  type ImplementRecord,
  implementRecordSchema,
} from "./implementStep.ts";
import type { IssueRef } from "./IssueWorkspaces.ts";
import type { AccountReading, UsageReader } from "./limitGuard.ts";
import { reviewRecordSchema } from "./reviewStep.ts";
import { type Command, runKnobsOf } from "./runKnobs.ts";
import { type RunResult, SpecRun, type SpecRunConfig } from "./SpecRun.ts";

const clonePaths = {
  "byro-repo": ".",
  "sheets-framework": "packages/framework",
};

const spec: IssueRef = { repo: "byro-repo", number: 213 };
const passes: Command = ["node", "-e", "process.exit(0)"];
const fails: Command = ["node", "-e", "process.exit(1)"];
const greenUnlessRed: Command = [
  "node",
  "-e",
  "process.exit(require('fs').existsSync('RED') ? 1 : 0)",
];

let temp: string;
let primaryRoot: string;
let github: FakeGitHub;
let notices: FakeNotices;
let usageReader: FakeUsageReader;

// Account 2 is always idle, so a run on account 1 shows it reads only its own account.
function readingOf(fiveHour: number, sevenDay: number): AccountReading[] {
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

beforeEach(() => {
  temp = realpathSync(mkdtempSync(join(tmpdir(), "spec-run-")));
  primaryRoot = join(temp, "byro-repo");
  github = FakeGitHub.init();
  notices = FakeNotices.init();
  usageReader = FakeUsageReader.init(readingOf(0.1, 0.2));
  buildPrimary();
});

afterEach(() => {
  rmSync(temp, { recursive: true, force: true });
});

function refOf(number: number): IssueRef {
  return { repo: "byro-repo", number };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function primaryOf(repo: keyof typeof clonePaths): string {
  return join(primaryRoot, clonePaths[repo]);
}

function buildPrimary(): void {
  Object.entries(clonePaths).forEach(([repo, clonePath]) => {
    const remote = join(temp, "remotes", `${repo}.git`);
    mkdirSync(remote, { recursive: true });
    git(remote, "init", "--bare", "-b", "master");
    const clone = join(primaryRoot, clonePath);
    mkdirSync(clone, { recursive: true });
    git(clone, "init", "-b", "master");
    git(clone, "config", "user.name", "Test");
    git(clone, "config", "user.email", "test@example.com");
    git(clone, "remote", "add", "origin", remote);
    const ignored = repo === "byro-repo" ? "packages/*\n" : "";
    writeFileSync(join(clone, ".gitignore"), ignored);
    writeFileSync(join(clone, "README.md"), `# ${repo}\n`);
    git(clone, "add", ".");
    git(clone, "commit", "-m", "Initial commit");
    git(clone, "push", "-u", "origin", "master");
  });
}

function commitRed(clone: string): void {
  writeFileSync(join(clone, "RED"), "");
  git(clone, "add", "RED");
  git(clone, "commit", "-m", "Turn master red");
}

function bodyWith(pairLine = "Opus high"): string {
  return `## What to build\n\nA thing.\n\n## Model fit\n\n${pairLine}\nA reason.\n`;
}

function addIssue(
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
  });
}

function addSpec(tickets: number[]): void {
  addIssue(spec.number, { labels: [], body: "## What to build\n\nA spec.\n" });
  github.edit(spec.number, { title: "The spec" });
  github.subIssues.set(spec.number, tickets);
  tickets.forEach((ticket) => addIssue(ticket));
}

function stateFolder(): string {
  return join(temp, "state");
}

function specRun(
  agentStep: FakeAgentStep,
  overrides: Partial<SpecRunConfig> = {},
): SpecRun {
  return SpecRun.init({
    knobs: runKnobsOf({
      clonePaths,
      checks: [greenUnlessRed],
      authChecks: [passes],
    }),
    agentStep,
    github,
    notices,
    usageReader,
    clock: { now: () => new Date("2026-10-12T09:00:00Z") },
    githubOwner: "byronbroughten",
    primaryRoot,
    workspaceFolder: join(temp, "workspaces"),
    symlinkedFiles: [],
    async installDependencies() {},
    promoteCommandOf: () => "npm run issue:promote -- byro-repo 1",
    outcomeFolder: "docs/agents/outcomes",
    stateFolder: stateFolder(),
    wrapUpKnobs: { backoffMs: 1, lockPollMs: 1 },
    async sleep() {},
    ...overrides,
  });
}

function resultOf(record: unknown): StepResult {
  return {
    output: { status: "valid", record },
    sessionId: "session",
    account: 1,
    configFolder: undefined,
    transcriptPath: undefined,
    peakContext: undefined,
    exitSubtype: "success",
    usage: undefined,
    limitHit: undefined,
  };
}

function recordOf(
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

// Commits `file` on the ticket's branch in the workspace, as a real implement step would.
function implemented(
  file: string,
  { content = "export {};\n", act = () => {} } = {},
): ScriptedStep {
  return async (request: StepRequest) => {
    act();
    writeFileSync(join(request.cwd, file), content);
    git(request.cwd, "add", file);
    git(request.cwd, "commit", "-m", `Add ${file}`);
    const branch = git(request.cwd, "branch", "--show-current");
    return resultOf(recordOf(branch, git(request.cwd, "rev-parse", "HEAD")));
  };
}

// Makes only GitHub writes and commits nothing, as an implement step on a ticket with no code would.
function applied(): StepResult {
  return resultOf({
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

function reviewed(findings: string[] = []): StepResult {
  return resultOf({ findings });
}

function masterSubjects(): string[] {
  return git(primaryOf("byro-repo"), "log", "--format=%s", "master").split(
    "\n",
  );
}

function ticketState(): Record<string, { step: string }> {
  const path = join(stateFolder(), "byro-repo-213.run.json");
  return (
    JSON.parse(readFileSync(path, "utf8")) as {
      tickets: Record<string, { step: string }>;
    }
  ).tickets;
}

describe("run", () => {
  it("implements, reviews, checks and lands each ticket of a two-ticket spec, leaving the spec open", async () => {
    addSpec([1, 2]);
    const agentStep = FakeAgentStep.init(
      implemented("one.ts"),
      reviewed(),
      implemented("two.ts"),
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result).toEqual<RunResult>({
      kind: "finished",
      landed: [refOf(1), refOf(2)],
      message:
        "Run ended: landed byro-repo #1, byro-repo #2. Every ticket is closed.",
    });
    expect([1, 2, 213].map((n) => github.issues.get(n)?.isOpen)).toEqual([
      false,
      false,
      true,
    ]);
    expect(masterSubjects()).toEqual(
      expect.arrayContaining([
        "Merge issue-1-ticket-1 into master (#1)",
        "Merge issue-2-ticket-2 into master (#2)",
      ]),
    );
    expect(
      git(join(temp, "remotes", "byro-repo.git"), "rev-parse", "master"),
    ).toBe(git(primaryOf("byro-repo"), "rev-parse", "master"));
    expect(notices.sent).toEqual([
      {
        specTitle: "The spec",
        summary:
          "Run started on 2 tickets as account 1: 5-hour 10%, weekly 20%.",
        link: "https://github.com/byronbroughten/byro-repo/issues/213",
      },
      {
        specTitle: "The spec",
        summary: result.message,
        link: "https://github.com/byronbroughten/byro-repo/issues/213",
      },
    ]);
  });

  it("runs every step in the ticket's issue workspace, logging each step's raw stream under the spec", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    await specRun(agentStep).run(spec);

    const steps = join(stateFolder(), "byro-repo-213-steps");
    expect(
      agentStep.requests.map(({ cwd, logPath }) => [cwd, logPath]),
    ).toEqual([
      [
        join(temp, "workspaces", "byro-repo-issue-1-ticket-1"),
        join(steps, "byro-repo-1-1-implement.jsonl"),
      ],
      [
        join(temp, "workspaces", "byro-repo-issue-1-ticket-1"),
        join(steps, "byro-repo-1-2-review.jsonl"),
      ],
    ]);
    expect(ticketState()).toEqual({
      "byro-repo #1": expect.objectContaining({ step: "landed" }),
    });
  });

  it("writes one timestamped progress line per event", async () => {
    addSpec([1]);

    await specRun(FakeAgentStep.init(implemented("one.ts"), reviewed())).run(
      spec,
    );

    const lines = readFileSync(join(stateFolder(), "byro-repo-213.log"), "utf8")
      .trimEnd()
      .split("\n");
    expect(
      lines.every((line) => line.startsWith("2026-10-12T09:00:00.000Z ")),
    ).toBe(true);
    expect(lines.map((line) => line.slice(25))).toEqual(
      expect.arrayContaining([
        "Run started on 1 tickets as account 1: 5-hour 10%, weekly 20%.",
        "byro-repo #1: launching on Opus high from implement.",
        "byro-repo #1: checking node -e process.exit(require('fs').existsSync('RED') ? 1 : 0).",
        "byro-repo #1: wrapping up.",
        "byro-repo #1: landed.",
      ]),
    );
  });

  it("keeps a Stop with multi-line output to timestamped lines", async () => {
    addSpec([1]);

    await specRun(FakeAgentStep.init(implemented("RED"), reviewed())).run(spec);

    const lines = readFileSync(join(stateFolder(), "byro-repo-213.log"), "utf8")
      .trimEnd()
      .split("\n");
    expect(
      lines.every((line) => line.startsWith("2026-10-12T09:00:00.000Z ")),
    ).toBe(true);
    expect(lines.map((line) => line.slice(25))).toContain(
      "byro-repo #1: stopped on red checks; details in the spec-issue comment.",
    );
  });

  it("runs a ticket's open blocker first, then breaks ties by sub-issue order", async () => {
    addSpec([1, 2, 3]);
    github.blockers.set(1, [3]);
    const agentStep = FakeAgentStep.init(
      implemented("two.ts"),
      reviewed(),
      implemented("three.ts"),
      reviewed(),
      implemented("one.ts"),
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(2), refOf(3), refOf(1)]);
  });

  it("lands the agent ticket, never launches a human ticket or the one it blocks, and names the blocking", async () => {
    addSpec([1, 2, 3]);
    github.edit(2, { labels: ["ready-for-human"] });
    github.blockers.set(3, [2]);
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    const result = await specRun(agentStep).run(spec);

    expect(result).toEqual<RunResult>({
      kind: "finished",
      landed: [refOf(1)],
      message:
        "Run ended: landed byro-repo #1. byro-repo #2 waits on the developer; byro-repo #3 is blocked by byro-repo #2.",
    });
    expect(agentStep.requests).toHaveLength(2);
    expect([1, 2, 3].map((n) => github.issues.get(n)?.isOpen)).toEqual([
      false,
      true,
      true,
    ]);
  });

  it("reads the label just before each launch, so a mid-run relabel takes effect", async () => {
    addSpec([1, 2]);
    const agentStep = FakeAgentStep.init(
      implemented("one.ts", {
        act: () => github.edit(2, { labels: ["ready-for-human"] }),
      }),
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(result.message).toBe(
      "Run ended: landed byro-repo #1. byro-repo #2 waits on the developer.",
    );
  });

  it("reads the pair just before each launch, so a mid-run edit takes effect", async () => {
    addSpec([1, 2]);
    const agentStep = FakeAgentStep.init(
      implemented("one.ts", {
        act: () => github.edit(2, { body: bodyWith("Sonnet medium") }),
      }),
      reviewed(),
      implemented("two.ts"),
      reviewed(),
    );

    await specRun(agentStep).run(spec);

    expect(agentStep.requests.map(({ pair }) => pair)).toEqual([
      { model: "opus", effort: "high" },
      { model: "opus", effort: "high" },
      { model: "sonnet", effort: "medium" },
      { model: "sonnet", effort: "medium" },
    ]);
  });

  it("lands an applied ticket without review or checks: one agent request, a row commit, the ticket closed with its write list", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(applied());
    const subjectsBefore = masterSubjects();

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(agentStep.requests.map(({ jsonSchema }) => jsonSchema)).toEqual([
      implementRecordSchema,
    ]);
    const progress = readFileSync(
      join(stateFolder(), "byro-repo-213.log"),
      "utf8",
    );
    expect(progress).not.toContain("checking");
    expect(masterSubjects()).toHaveLength(subjectsBefore.length + 1);
    expect(masterSubjects()[0]).toContain("#1");
    expect(github.issues.get(1)?.isOpen).toBe(false);
    const closing = github.closed.find(
      ({ issue }) => issue.number === 1,
    )?.comment;
    expect(closing).toContain(
      "- comment on byronbroughten/byro-repo#213: Posted the addendum.",
    );
  });

  it("runs a ticketless spec with its own Model fit as one ticket, closing it", async () => {
    addIssue(spec.number);
    const agentStep = FakeAgentStep.init(implemented("spec.ts"), reviewed());

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([spec]);
    expect(github.issues.get(spec.number)?.isOpen).toBe(false);
  });
});

describe("run's Model fit refusal", () => {
  it("lists each open ready-for-agent ticket with a missing or invalid section, and checks neither the spec nor other tickets", async () => {
    addSpec([1, 2, 3, 4]);
    github.edit(2, { body: "## What to build\n\nNo section.\n" });
    github.edit(3, { body: bodyWith("Haiku low") });
    github.edit(4, {
      labels: ["ready-for-human"],
      body: "## What to build\n\nNo section.\n",
    });
    const agentStep = FakeAgentStep.init();

    const result = await specRun(agentStep).run(spec);

    expect(result).toEqual<RunResult>({
      kind: "refused",
      landed: [],
      message:
        "Each open ready-for-agent ticket needs a ## Model fit section naming one of the five pairs; missing or invalid in byro-repo #2, byro-repo #3.",
    });
    expect(agentStep.requests).toEqual([]);
    expect(notices.sent).toEqual([]);
  });

  it("tells a ticketless spec with no section to split it or add one", async () => {
    addIssue(spec.number, { body: "## What to build\n\nA spec.\n" });

    const result = await specRun(FakeAgentStep.init()).run(spec);

    expect(result).toEqual<RunResult>({
      kind: "refused",
      landed: [],
      message:
        "byro-repo #213 has no sub-issues and no valid ## Model fit section: split it with /to-tickets, or add the section.",
    });
  });
});

describe("run's preflight", () => {
  async function preflightOf(
    overrides: Partial<SpecRunConfig> = {},
  ): Promise<RunResult> {
    addSpec([1]);
    const agentStep = FakeAgentStep.init();
    const result = await specRun(agentStep, overrides).run(spec);
    expect(agentStep.requests).toEqual([]);
    expect(notices.sent.map(({ summary }) => summary)).toEqual([
      result.message,
    ]);
    return result;
  }

  it("Stops when an auth check fails", async () => {
    const result = await preflightOf({
      knobs: runKnobsOf({
        clonePaths,
        checks: [],
        authChecks: [passes, fails],
      }),
    });

    expect(result).toEqual<RunResult>({
      kind: "stopped",
      landed: [],
      message:
        "Preflight stopped the run: node -e process.exit(1) failed: GitHub auth or the claude login is missing",
    });
  });

  it("Stops when a primary clone is missing", async () => {
    rmSync(primaryOf("sheets-framework"), { recursive: true, force: true });

    const result = await preflightOf();

    expect(result.message).toBe(
      `Preflight stopped the run: sheets-framework's primary clone is missing at ${primaryOf("sheets-framework")}`,
    );
  });

  it("Stops when a primary checkout isn't on master", async () => {
    git(primaryOf("sheets-framework"), "switch", "-c", "elsewhere");

    const result = await preflightOf();

    expect(result.message).toBe(
      "Preflight stopped the run: sheets-framework's primary checkout is on elsewhere, not master",
    );
  });

  it("Stops on a red master commit though an uncommitted edit would turn it green", async () => {
    commitRed(primaryRoot);
    rmSync(join(primaryRoot, "RED"));

    const result = await preflightOf();

    expect(result.message).toBe(
      "Preflight stopped the run: master red: node -e process.exit(require('fs').existsSync('RED') ? 1 : 0)",
    );
    expect(git(primaryRoot, "status", "--porcelain")).toBe("D RED");
  });

  it("checks the commit master points to at each preflight, not the one an earlier run saw", async () => {
    addSpec([1]);
    // A human ticket, so the first run ends straight after its preflight.
    github.edit(1, { labels: ["ready-for-human"] });
    const first = await specRun(FakeAgentStep.init()).run(spec);
    commitRed(primaryRoot);

    const second = await specRun(FakeAgentStep.init()).run(spec);

    expect(first.kind).toBe("finished");
    expect(second.message).toBe(
      "Preflight stopped the run: master red: node -e process.exit(require('fs').existsSync('RED') ? 1 : 0)",
    );
  });

  it("rebuilds a master set an earlier run left half-removed", async () => {
    addSpec([1]);
    github.edit(1, { labels: ["ready-for-human"] });
    await specRun(FakeAgentStep.init()).run(spec);
    rmSync(join(temp, "workspaces", "master-byro-repo-213", ".git"));
    commitRed(primaryRoot);

    const result = await specRun(FakeAgentStep.init()).run(spec);

    expect(result.message).toBe(
      "Preflight stopped the run: master red: node -e process.exit(require('fs').existsSync('RED') ? 1 : 0)",
    );
  });

  it("Stops when the master set fails to build", async () => {
    const result = await preflightOf({
      async installDependencies() {
        throw new Error("npm install failed");
      },
    });

    expect(result.message).toBe(
      "Preflight stopped the run: the master set failed to build: npm install failed",
    );
  });

  it("Stops on a red master commit in a package clone", async () => {
    const redClone: Command = [
      "node",
      "-e",
      "process.exit(require('fs').existsSync('packages/framework/RED') ? 1 : 0)",
    ];
    commitRed(primaryOf("sheets-framework"));

    const result = await preflightOf({
      knobs: runKnobsOf({ clonePaths, checks: [redClone], authChecks: [] }),
    });

    expect(result.message).toBe(
      `Preflight stopped the run: master red: ${redClone.join(" ")}`,
    );
  });

  it("checks master's commits, so an uncommitted edit that would fail a check neither Stops the run nor is touched", async () => {
    writeFileSync(join(primaryRoot, "RED"), "");
    addSpec([1]);
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(git(primaryRoot, "status", "--porcelain")).toBe("?? RED");
    expect(git(primaryRoot, "branch", "--show-current")).toBe("master");
  });
});

describe("run's unhandled Stops", () => {
  const stepError: StepResult = {
    ...reviewed(),
    output: { status: "none" },
    exitSubtype: "error_max_turns",
  };
  const schemaFailure: StepResult = {
    ...reviewed(),
    output: {
      status: "schemaFailure",
      rawOutput: "{}",
      problems: ["findings is required"],
    },
  };

  function blocked(): ScriptedStep {
    return async (request) =>
      resultOf(
        recordOf(git(request.cwd, "branch", "--show-current"), "", {
          status: "blocked",
          blockers: [
            {
              kind: "gated-action",
              detail: "It needs app:build.",
              recommendation: "Run it by hand.",
            },
          ],
        }),
      );
  }

  const outcomes: {
    outcome: string;
    steps: () => ScriptedStep[];
    logFile: string;
  }[] = [
    {
      outcome: "review findings",
      steps: () => [implemented("one.ts"), reviewed(["one.ts:1 is wrong."])],
      logFile: "byro-repo-213-steps/byro-repo-1-2-review.jsonl",
    },
    {
      outcome: "red checks",
      steps: () => [implemented("RED"), reviewed()],
      logFile: "byro-repo-213.log",
    },
    {
      outcome: "a step error",
      steps: () => [implemented("one.ts"), stepError],
      logFile: "byro-repo-213-steps/byro-repo-1-2-review.jsonl",
    },
    {
      outcome: "a blocker in the implement record",
      steps: () => [blocked()],
      logFile: "byro-repo-213-steps/byro-repo-1-1-implement.jsonl",
    },
    {
      outcome: "a schema failure",
      steps: () => [implemented("one.ts"), schemaFailure],
      logFile: "byro-repo-213-steps/byro-repo-1-2-review.jsonl",
    },
  ];

  it.each(outcomes)(
    "leaves the ticket unlanded in its workspace on $outcome, comments, sends one notice and ends the run",
    async ({ outcome, steps, logFile }) => {
      addSpec([1, 2]);

      const run = specRun(FakeAgentStep.init(...steps()));
      const result = await run.run(spec);

      expect(result).toEqual<RunResult>({
        kind: "stopped",
        landed: [],
        message: `Stopped on byro-repo #1: ${outcome}.`,
      });
      expect(github.issues.get(1)?.isOpen).toBe(true);
      expect(await run.workspaces.find(refOf(1))).toBeDefined();
      expect(github.comments).toHaveLength(1);
      expect(github.comments[0]?.issue).toEqual(spec);
      expect(github.comments[0]?.body).toContain(
        `The runner stopped on byro-repo #1, "Ticket 1": ${outcome}.`,
      );
      expect(github.comments[0]?.body).toContain(
        `Log: \`${join(stateFolder(), logFile)}\``,
      );
      expect(notices.sent.map(({ summary }) => summary)).toEqual([
        "Run started on 2 tickets as account 1: 5-hour 10%, weekly 20%.",
        result.message,
      ]);
    },
  );

  it("Stops again on a rerun while the stopped ticket is open, naming it", async () => {
    addSpec([1, 2]);
    await specRun(
      FakeAgentStep.init(implemented("one.ts"), reviewed(["A finding."])),
    ).run(spec);
    const rerunStep = FakeAgentStep.init();

    const result = await specRun(rerunStep).run(spec);

    expect(result).toEqual<RunResult>({
      kind: "stopped",
      landed: [],
      message:
        "byro-repo #1 is still open after its Stop (review findings); finish and land it, then rerun.",
    });
    expect(rerunStep.requests).toEqual([]);
  });

  it("skips the stopped ticket on a rerun once it is closed", async () => {
    addSpec([1, 2]);
    await specRun(
      FakeAgentStep.init(implemented("one.ts"), reviewed(["A finding."])),
    ).run(spec);
    github.edit(1, { isOpen: false });

    const result = await specRun(
      FakeAgentStep.init(implemented("two.ts"), reviewed()),
    ).run(spec);

    expect(result.landed).toEqual([refOf(2)]);
  });
});

describe("run's resume", () => {
  it("resumes a killed run at the step it reached, re-detaching the workspace's detached repos", async () => {
    addSpec([1]);
    let reachReview = () => {};
    const reachedReview = new Promise<void>((resolve) => {
      reachReview = resolve;
    });
    void specRun(
      FakeAgentStep.init(implemented("one.ts"), async () => {
        reachReview();
        return new Promise<StepResult>(() => {});
      }),
    ).run(spec);
    await reachedReview;
    const framework = primaryOf("sheets-framework");
    writeFileSync(join(framework, "later.ts"), "export {};\n");
    git(framework, "add", "later.ts");
    git(framework, "commit", "-m", "Add later.ts");
    let detachedHead = "";
    const rerunStep = FakeAgentStep.init(async (request) => {
      detachedHead = git(
        join(request.cwd, "packages/framework"),
        "rev-parse",
        "HEAD",
      );
      return reviewed();
    });

    const result = await specRun(rerunStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(rerunStep.requests.map(({ jsonSchema }) => jsonSchema)).toEqual([
      reviewRecordSchema,
    ]);
    expect(detachedHead).toBe(git(framework, "rev-parse", "master"));
    expect(masterSubjects()).toContain(
      "Merge issue-1-ticket-1 into master (#1)",
    );
  });

  it("resumes an applied ticket killed at its wrap-up and lands it with no agent request", async () => {
    addSpec([1]);
    let reachWrapUp = () => {};
    const reachedWrapUp = new Promise<void>((resolve) => {
      reachWrapUp = resolve;
    });
    let reads = 0;
    // Reads at run start, before implement, then in the wrap-up, where it hangs.
    const hangingReader: UsageReader = {
      async read() {
        reads += 1;
        if (reads < 3) return readingOf(0.1, 0.2);
        reachWrapUp();
        return new Promise<AccountReading[]>(() => {});
      },
    };
    void specRun(FakeAgentStep.init(applied()), {
      usageReader: hangingReader,
    }).run(spec);
    await reachedWrapUp;
    expect(ticketState()["byro-repo #1"]?.step).toBe("wrap-up");
    const rerunStep = FakeAgentStep.init();

    const result = await specRun(rerunStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(rerunStep.requests).toEqual([]);
    expect(github.issues.get(1)?.isOpen).toBe(false);
  });

  it("lets GitHub win: a ticket closed outside the run is skipped whatever its saved step", async () => {
    addSpec([1, 2]);
    let reachReview = () => {};
    const reachedReview = new Promise<void>((resolve) => {
      reachReview = resolve;
    });
    void specRun(
      FakeAgentStep.init(implemented("one.ts"), async () => {
        reachReview();
        return new Promise<StepResult>(() => {});
      }),
    ).run(spec);
    await reachedReview;
    github.edit(1, { isOpen: false });

    const result = await specRun(
      FakeAgentStep.init(implemented("two.ts"), reviewed()),
    ).run(spec);

    expect(result.landed).toEqual([refOf(2)]);
  });
});
describe("run's limit guard", () => {
  function summaries(): string[] {
    return notices.sent.map(({ summary }) => summary);
  }

  it("waits out a 5-hour limit on the configured account until the reset plus a margin, with one notice, then lands", async () => {
    addSpec([1]);
    usageReader = FakeUsageReader.init(
      readingOf(0.92, 0.5),
      readingOf(0.92, 0.5),
      readingOf(0.1, 0.5),
    );
    const sleeps: number[] = [];
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    const result = await specRun(agentStep, {
      async sleep(ms) {
        sleeps.push(ms);
      },
    }).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(sleeps).toEqual([2 * 60 * 60_000 + 5 * 60_000]);
    expect(summaries()).toEqual([
      "Run started on 1 tickets as account 1: 5-hour 92%, weekly 50%.",
      "Limit wait: account 1 is at 92% of its 5-hour limit; continuing after 2026-10-12T11:05:00.000Z.",
      result.message,
    ]);
  });

  it("Stops before a step past the weekly reserve, with one notice, leaving the ticket for a rerun to resume", async () => {
    addSpec([1]);
    usageReader = FakeUsageReader.init(readingOf(0.3, 0.96));
    const agentStep = FakeAgentStep.init();

    const result = await specRun(agentStep).run(spec);

    expect(result).toEqual<RunResult>({
      kind: "stopped",
      landed: [],
      message:
        "Account 1 is at 96% of its weekly limit, past the reserve; rerun after it resets at 2026-10-15T00:00:00.000Z.",
    });
    expect(agentStep.requests).toEqual([]);
    expect(summaries()).toEqual([
      "Run started on 1 tickets as account 1: 5-hour 30%, weekly 96%.",
      result.message,
    ]);
    usageReader = FakeUsageReader.init(readingOf(0.3, 0.5));

    const rerun = await specRun(
      FakeAgentStep.init(implemented("one.ts"), reviewed()),
    ).run(spec);

    expect(rerun.landed).toEqual([refOf(1)]);
  });

  function limitHitStep(
    stream: string,
    limitHit: StepResult["limitHit"],
  ): ScriptedStep {
    return async (request) => {
      writeFileSync(request.logPath ?? "", stream);
      return {
        ...resultOf(undefined),
        output: { status: "none" },
        exitSubtype: "error_during_execution",
        limitHit,
      };
    };
  }

  function savedLimitHit(): string {
    return readFileSync(join(stateFolder(), "first-limit-hit.jsonl"), "utf8");
  }

  it("Stops unhandled on a limit hit mid-step, naming the reset, and keeps the first limit-hit stream it sees", async () => {
    addSpec([1]);
    const hit = {
      window: "five_hour",
      resetsAt: new Date("2026-10-12T11:00:00Z"),
    };

    const result = await specRun(
      FakeAgentStep.init(limitHitStep("first stream\n", hit)),
    ).run(spec);

    expect(result.message).toBe("Stopped on byro-repo #1: a limit hit.");
    expect(github.issues.get(1)?.isOpen).toBe(true);
    expect(github.comments[0]?.body).toContain(
      "The step hit the five_hour limit; it resets at 2026-10-12T11:00:00.000Z.",
    );
    expect(savedLimitHit()).toBe("first stream\n");
    addIssue(2);
    github.subIssues.set(spec.number, [1, 2]);
    github.edit(1, { isOpen: false });

    await specRun(FakeAgentStep.init(limitHitStep("later stream\n", hit))).run(
      spec,
    );

    expect(savedLimitHit()).toBe("first stream\n");
  });

  it("warns once on a limit error with no reset and Stops unhandled", async () => {
    addSpec([1]);

    const result = await specRun(
      FakeAgentStep.init(
        limitHitStep("bare 429\n", { window: undefined, resetsAt: undefined }),
      ),
    ).run(spec);

    expect(result.message).toBe("Stopped on byro-repo #1: a limit hit.");
    expect(github.comments[0]?.body).toContain(
      "The step hit an unrecognised limit error; its reset is unknown.",
    );
    expect(summaries()).toEqual([
      "Run started on 1 tickets as account 1: 5-hour 10%, weekly 20%.",
      "Unrecognised limit error on account 1; the saved stream can tighten detection.",
      result.message,
    ]);
    expect(savedLimitHit()).toBe("bare 429\n");
  });

  it("warns once per run on a missing reading and launches each step unguarded", async () => {
    addSpec([1, 2]);
    usageReader = FakeUsageReader.init(new Error("cswap: not found"));
    const agentStep = FakeAgentStep.init(
      implemented("one.ts"),
      reviewed(),
      implemented("two.ts"),
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1), refOf(2)]);
    expect(summaries()).toEqual([
      "Run started on 2 tickets as account 1: no usage reading.",
      "No usage reading for account 1; steps launch unguarded.",
      result.message,
    ]);
  });

  it("records the reading before the ticket's first step and after its last as the outcome's Limit used", async () => {
    addSpec([1]);
    usageReader = FakeUsageReader.init(
      readingOf(0.1, 0.2),
      readingOf(0.1, 0.2),
      readingOf(0.3, 0.22),
      readingOf(0.4, 0.25),
    );

    await specRun(FakeAgentStep.init(implemented("one.ts"), reviewed())).run(
      spec,
    );

    expect(git(primaryOf("byro-repo"), "log", "-p", "master")).toContain(
      "5-hour 10% → 40%, weekly 20% → 25%",
    );
  });

  it("pushes one Limit wait notice though a reading after the wait is still over", async () => {
    addSpec([1]);
    usageReader = FakeUsageReader.init(
      readingOf(0.92, 0.5),
      readingOf(0.92, 0.5),
      readingOf(0.92, 0.5),
      readingOf(0.1, 0.5),
    );

    const result = await specRun(
      FakeAgentStep.init(implemented("one.ts"), reviewed()),
    ).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(
      summaries().filter((summary) => summary.startsWith("Limit wait")),
    ).toHaveLength(1);
  });

  it("lands a step that met a limit but still succeeded", async () => {
    addSpec([1]);
    const hit = { window: "five_hour", resetsAt: undefined };

    const result = await specRun(
      FakeAgentStep.init(implemented("one.ts"), {
        ...reviewed(),
        limitHit: hit,
      }),
    ).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
  });
});
