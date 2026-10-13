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
import { FakeNotices } from "./FakeNotices.ts";
import type { ImplementRecord } from "./implementStep.ts";
import type { IssueRef } from "./IssueWorkspaces.ts";
import { reviewRecordSchema } from "./reviewStep.ts";
import { type Command, runKnobsOf } from "./runKnobs.ts";
import {
  type RunGitHub,
  type RunResult,
  SpecRun,
  type SpecRunConfig,
  type TrackedIssue,
} from "./SpecRun.ts";
import type { ParentIssue } from "./WrapUp.ts";

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

class FakeGitHub implements RunGitHub {
  issues = new Map<number, TrackedIssue>();
  subIssues = new Map<number, number[]>();
  blockers = new Map<number, number[]>();
  comments: { issue: IssueRef; body: string }[] = [];

  async issueOf({ number }: IssueRef): Promise<TrackedIssue> {
    const issue = this.issues.get(number);
    if (!issue) throw new Error(`No issue #${number}`);
    return { ...issue, labels: [...issue.labels] };
  }

  async subIssuesOf({ number }: IssueRef): Promise<IssueRef[]> {
    return (this.subIssues.get(number) ?? []).map(refOf);
  }

  async openBlockersOf({ number }: IssueRef): Promise<IssueRef[]> {
    return (this.blockers.get(number) ?? [])
      .filter((blocker) => this.issues.get(blocker)?.isOpen)
      .map(refOf);
  }

  async comment(issue: IssueRef, body: string): Promise<void> {
    this.comments.push({ issue, body });
  }

  async closeIssue({ number }: IssueRef): Promise<void> {
    this.edit(number, { isOpen: false });
  }

  async parentOf({ number }: IssueRef): Promise<ParentIssue | undefined> {
    const tickets = this.subIssues.get(spec.number) ?? [];
    if (!tickets.includes(number)) return undefined;
    const completed = tickets.filter(
      (ticket) => !this.issues.get(ticket)?.isOpen,
    ).length;
    return {
      issue: spec,
      labels: [],
      subIssues: { total: tickets.length, completed },
    };
  }

  async commentsOf(): Promise<string[]> {
    return [];
  }

  edit(number: number, change: Partial<TrackedIssue>): void {
    const issue = this.issues.get(number);
    if (!issue) throw new Error(`No issue #${number}`);
    this.issues.set(number, { ...issue, ...change });
  }
}

beforeEach(() => {
  temp = realpathSync(mkdtempSync(join(tmpdir(), "spec-run-")));
  primaryRoot = join(temp, "byro-repo");
  github = new FakeGitHub();
  notices = FakeNotices.init();
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
    closing_comment: "Landed it.",
    boxes_undone: [],
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
        summary: "Run started on 2 tickets.",
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
        "Run started on 1 tickets.",
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

  it("Stops on a red master, naming the command", async () => {
    writeFileSync(join(primaryRoot, "RED"), "");

    const result = await preflightOf();

    expect(result.message).toBe(
      "Preflight stopped the run: master red: node -e process.exit(require('fs').existsSync('RED') ? 1 : 0)",
    );
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
        "Run started on 2 tickets.",
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
