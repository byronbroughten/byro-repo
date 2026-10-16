import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeGitHub } from "./FakeGitHub.ts";
import {
  type IssueRef,
  IssueWorkspaces,
  type IssueWorkspacesConfig,
  type Workspace,
} from "./IssueWorkspaces.ts";
import { WrapUp, type WrapUpConfig, type WrapUpFacts } from "./WrapUp.ts";
import { WrapUpFailure, type WrapUpFailureKind } from "./WrapUpFailure.ts";

const clonePaths = {
  "byro-repo": ".",
  "sheets-framework": "packages/framework",
};

const ticket: IssueRef = { repo: "byro-repo", number: 218 };
const spec: IssueRef = { repo: "byro-repo", number: 213 };
const outcomePath = "docs/agents/outcomes/byro-repo-213/byro-repo-218.md";
const redCheck: [string, ...string[]] = [
  "node",
  "-e",
  "process.exit(require('fs').existsSync('RED') ? 1 : 0)",
];

let temp: string;
let primaryRoot: string;
let github: FakeGitHub;
let sleeps: number[];

beforeEach(() => {
  temp = realpathSync(mkdtempSync(join(tmpdir(), "wrap-up-")));
  primaryRoot = join(temp, "byro-repo");
  github = FakeGitHub.init();
  github.parents.set(ticket.number, {
    issue: spec,
    labels: [],
    subIssues: { total: 3, completed: 2 },
  });
  sleeps = [];
  buildPrimary();
});

afterEach(() => {
  rmSync(temp, { recursive: true, force: true });
});

function workspacesConfig(): IssueWorkspacesConfig {
  return {
    primaryRoot,
    clonePaths,
    workspaceFolder: join(temp, "workspaces"),
    symlinkedFiles: [],
    async installDependencies() {},
    async issueTitle() {
      return "Wrap-up script";
    },
  };
}

function wrapUp(overrides: Partial<WrapUpConfig> = {}): WrapUp {
  return WrapUp.init({
    workspaces: workspacesConfig(),
    github,
    githubOwner: "byronbroughten",
    checks: [redCheck],
    outcomeFolder: "docs/agents/outcomes",
    stateFolder: join(temp, "state"),
    knobs: { backoffMs: 100, lockPollMs: 1 },
    async sleep(ms) {
      sleeps.push(ms);
    },
    ...overrides,
  });
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

function remoteOf(repo: keyof typeof clonePaths): string {
  return join(temp, "remotes", `${repo}.git`);
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

async function workspaceWith(
  extraRepos: string[] = [],
  issue: IssueRef = ticket,
): Promise<Workspace> {
  return IssueWorkspaces.init(workspacesConfig()).create(issue, {
    slug: "wrap up script",
    extraRepos,
  });
}

function commitIn(
  workspace: Workspace,
  repo: keyof typeof clonePaths,
  file: string,
  content: string,
): void {
  const worktree = join(workspace.path, clonePaths[repo]);
  writeFileSync(join(worktree, file), content);
  git(worktree, "add", file);
  git(worktree, "commit", "-m", `Add ${file}`);
}

function writeFacts(facts: Partial<WrapUpFacts> = {}): void {
  mkdirSync(join(temp, "state"), { recursive: true });
  const full: WrapUpFacts = {
    branches: [{ repo: "byro-repo", branch: "issue-218-wrap-up-script" }],
    closingComment: "Landed the wrap-up script.",
    pair: "Opus medium",
    peakContext: [150_000, 90_000],
    reviewFixes: "none",
    ...facts,
  };
  writeFileSync(
    join(temp, "state", "byro-repo-218.facts.json"),
    JSON.stringify(full),
  );
}

function commitRed(clone: string): void {
  writeFileSync(join(clone, "RED"), "");
  git(clone, "add", "RED");
  git(clone, "commit", "-m", "Turn master red");
}

function subjectsOf(repo: keyof typeof clonePaths, ref = "master"): string[] {
  return git(primaryOf(repo), "log", "--topo-order", "--format=%s", ref).split(
    "\n",
  );
}

async function failureOf(run: Promise<unknown>): Promise<WrapUpFailureKind> {
  try {
    await run;
  } catch (error) {
    if (error instanceof WrapUpFailure) return error.kind;
    throw error;
  }
  throw new Error("Expected the wrap-up to fail");
}

describe("run", () => {
  it("merges the branch, commits the log row and lands both on the pushed master", async () => {
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts();

    await wrapUp().run(ticket);

    expect(subjectsOf("byro-repo").slice(0, 3)).toEqual([
      "Record the #218 outcome: Opus medium, 1 files, 150K → 90K, first-try pass.",
      "Merge issue-218-wrap-up-script into master (#218)",
      "Add script.ts",
    ]);
    expect(git(remoteOf("byro-repo"), "rev-parse", "master")).toBe(
      git(primaryOf("byro-repo"), "rev-parse", "master"),
    );
    expect(existsSync(join(primaryRoot, "script.ts"))).toBe(true);
  });

  it("writes the outcome row in the spec's folder with every column", async () => {
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts({ reviewFixes: "triage", whatReviewCaught: "A stale doc link" });

    await wrapUp().run(ticket);

    expect(readFileSync(join(primaryRoot, outcomePath), "utf8")).toBe(
      [
        "# byro-repo#218 outcome",
        "",
        "Spec: [byro-repo#213](https://github.com/byronbroughten/byro-repo/issues/213)",
        "",
        "| Issue | Pair | Account | Files changed | Peak context | Result | Defers | Review rounds | Retries | Duration | Cost (API-equivalent) | Triage cost | Limit used | What review caught | Session ids |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        "| #218 | Opus medium | unrecorded | 1 | 150K → 90K | Triage fix | 0 | 1 | 0 | unrecorded | unrecorded | unrecorded | unrecorded | A stale doc link | unrecorded |",
        "",
      ].join("\n"),
    );
  });

  it("computes the row's facts from the recorded sessions and the ticket's handoff comment", async () => {
    const configFolder = join(temp, "account-2");
    cpSync(
      join(import.meta.dirname, "..", "fixtures", "transcripts"),
      join(configFolder, "projects", "-workspace-byro-repo"),
      { recursive: true },
    );
    github.comments.push(
      { issue: ticket, body: "Picking this up." },
      {
        issue: ticket,
        body: "## Handoff\n\nWork so far.\n\nsession: session-implement-1",
      },
    );
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts({
      pair: undefined,
      peakContext: undefined,
      sessions: {
        account: 2,
        configFolder,
        steps: [
          { agent: "implement", sessionId: "session-implement-2" },
          { agent: "review", sessionId: "session-review" },
          { agent: "triage", sessionId: "session-triage" },
          { agent: "fix", sessionId: "session-fix" },
        ],
      },
      limitReadings: {
        before: { fiveHour: 0.12, sevenDay: 0.3 },
        after: { fiveHour: 0.4, sevenDay: 0.34 },
      },
    });

    await wrapUp().run(ticket);

    expect(
      readFileSync(join(primaryRoot, outcomePath), "utf8").split("\n")[6],
    ).toBe(
      "| #218 | Opus medium | 2 | 1 | 150K → 90K | Pass | 0 | 1 | 0 | 42 min | $1.48 | $0.06 | 5-hour 12% → 40%, weekly 30% → 34% | — | session-implement-1, session-implement-2, session-review, session-triage, session-fix |",
    );
  });

  it("puts a ticketless spec's row in a folder of its own", async () => {
    github.parents.clear();
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts();

    await wrapUp().run(ticket);

    const ownFolder = "docs/agents/outcomes/byro-repo-218/byro-repo-218.md";
    expect(existsSync(join(primaryRoot, ownFolder))).toBe(true);
  });

  it("lands each repo's branch in landing order, the clone before the root", async () => {
    const workspace = await workspaceWith(["sheets-framework"]);
    commitIn(workspace, "sheets-framework", "core.ts", "export {};\n");
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts({
      branches: [
        { repo: "sheets-framework", branch: "issue-218-wrap-up-script" },
        { repo: "byro-repo", branch: "issue-218-wrap-up-script" },
      ],
    });

    const result = await wrapUp().run(ticket);

    expect(result.filesChanged).toBe(2);
    expect(subjectsOf("sheets-framework").slice(0, 2)).toEqual([
      "Merge issue-218-wrap-up-script into master (#218)",
      "Add core.ts",
    ]);
    expect(git(remoteOf("sheets-framework"), "rev-parse", "master")).toBe(
      git(primaryOf("sheets-framework"), "rev-parse", "master"),
    );
  });

  it("commits the row to the root even when only a clone's branch lands", async () => {
    const workspace = await workspaceWith([], {
      repo: "byro-repo",
      number: 218,
    });
    await IssueWorkspaces.init(workspacesConfig()).promote(
      workspace,
      "sheets-framework",
    );
    commitIn(workspace, "sheets-framework", "core.ts", "export {};\n");
    writeFacts({
      branches: [
        { repo: "sheets-framework", branch: "issue-218-wrap-up-script" },
      ],
    });

    await wrapUp().run(ticket);

    expect(subjectsOf("byro-repo")[0]).toBe(
      "Record the #218 outcome: Opus medium, 1 files, 150K → 90K, first-try pass.",
    );
    expect(git(remoteOf("byro-repo"), "rev-parse", "master")).toBe(
      git(primaryOf("byro-repo"), "rev-parse", "master"),
    );
  });

  it("deletes the branch locally and on the remote, removes the workspace and closes the issue", async () => {
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    git(join(workspace.path), "push", "origin", "issue-218-wrap-up-script");
    writeFacts({
      boxesUndone: [{ box: "Fake gh tests", reason: "covered by a port" }],
    });

    await wrapUp().run(ticket);

    expect(git(primaryOf("byro-repo"), "branch", "--list", "issue-218-*")).toBe(
      "",
    );
    expect(git(remoteOf("byro-repo"), "branch", "--list", "issue-218-*")).toBe(
      "",
    );
    expect(existsSync(workspace.path)).toBe(false);
    expect(github.closed).toEqual([
      {
        issue: ticket,
        comment:
          "Landed the wrap-up script.\n\nLeft undone:\n- Fake gh tests: covered by a port",
      },
    ]);
  });

  it("releases the lease of the session landing it, removing the workspace", async () => {
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    await IssueWorkspaces.init(workspacesConfig()).takeLease(workspace, {
      kind: "session",
      pid: process.ppid,
    });
    writeFacts();

    await wrapUp().run(ticket);

    expect(existsSync(workspace.path)).toBe(false);
    expect(await IssueWorkspaces.init(workspacesConfig()).list()).toEqual([]);
    expect(github.closed.map(({ issue }) => issue)).toEqual([ticket]);
  });

  it("logs a failed branch delete, keeps the workspace and still closes the issue", async () => {
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts();

    const result = await wrapUp({
      log(line) {
        if (line === "Done: push.") {
          renameSync(remoteOf("byro-repo"), `${remoteOf("byro-repo")}.gone`);
        }
      },
    }).run(ticket);

    expect(result.branchDeleteFailures).toHaveLength(1);
    expect(existsSync(workspace.path)).toBe(true);
    expect(github.closed).toHaveLength(1);
  });

  it("names a parent whose sub-issues are all closed as ready to close", async () => {
    github.parents.set(ticket.number, {
      issue: spec,
      labels: [],
      subIssues: { total: 3, completed: 3 },
    });
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts();

    const result = await wrapUp().run(ticket);

    expect(result.parent).toEqual({ kind: "ready-to-close", parent: spec });
  });

  it("never offers a wayfinder map for closing", async () => {
    github.parents.set(ticket.number, {
      issue: spec,
      labels: ["wayfinder:map"],
      subIssues: { total: 3, completed: 3 },
    });
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts();

    const result = await wrapUp().run(ticket);

    expect(result.parent).toEqual({ kind: "map", parent: spec });
  });

  it("fails the parent check when the parent's sub-issue summary can't be read", async () => {
    github.parents.set(ticket.number, {
      issue: spec,
      labels: [],
      subIssues: undefined,
    });
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts();

    expect(await failureOf(wrapUp().run(ticket))).toBe("parent-check");
    expect(github.closed).toHaveLength(1);
  });

  it("retries a failing gh call with exponential backoff", async () => {
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts();
    github.failuresLeft = 2;

    await wrapUp().run(ticket);

    expect(sleeps).toEqual([100, 200]);
    expect(github.closed).toHaveLength(1);
  });

  it("gives up as a network failure after three tries", async () => {
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts();
    github.failuresLeft = 3;

    expect(await failureOf(wrapUp().run(ticket))).toBe("network");
    expect(sleeps).toEqual([100, 200]);
  });

  it("rebuilds the merge and reruns the checks when master moved during them", async () => {
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts();
    const movedOnce = join(temp, "moved");
    const moveMaster: [string, ...string[]] = [
      "node",
      "-e",
      `const fs = require("fs");
       if (!fs.existsSync(${JSON.stringify(movedOnce)})) {
         fs.writeFileSync(${JSON.stringify(movedOnce)}, "");
         require("child_process").execFileSync("git", ["commit", "--allow-empty", "-m", "Meanwhile on master"], { cwd: ${JSON.stringify(primaryRoot)} });
       }`,
    ];

    await wrapUp({ checks: [moveMaster] }).run(ticket);

    const firstParents = git(
      primaryRoot,
      "log",
      "--first-parent",
      "--format=%s",
    );
    expect(firstParents.split("\n")).toEqual([
      "Record the #218 outcome: Opus medium, 1 files, 150K → 90K, first-try pass.",
      "Merge issue-218-wrap-up-script into master (#218)",
      "Meanwhile on master",
      "Initial commit",
    ]);
  });

  describe("a ticket that needed only GitHub writes", () => {
    const githubWrites = [
      {
        issue: "byronbroughten/byro-repo#213",
        action: "comment" as const,
        url: "https://github.com/byronbroughten/byro-repo/issues/213#issuecomment-1",
        summary: "Posted the addendum.",
      },
      {
        issue: "byronbroughten/byro-repo#246",
        action: "edit" as const,
        url: "https://github.com/byronbroughten/byro-repo/issues/246",
        summary: "Retitled it.",
      },
    ];

    function writeAppliedFacts(): void {
      writeFacts({
        branches: [],
        closingComment: "Posted the addendum and retitled #246.",
        reviewFixes: "skipped",
        githubWrites,
      });
    }

    it("lands only the log row, skipping the merges and checks, and closes the issue with the write list", async () => {
      const workspace = await workspaceWith();
      commitRed(primaryRoot);
      writeAppliedFacts();

      const result = await wrapUp().run(ticket);

      expect(subjectsOf("byro-repo").slice(0, 2)).toEqual([
        "Record the #218 outcome: Opus medium, 0 files, 150K → 90K, review skipped (no code).",
        "Turn master red",
      ]);
      expect(git(remoteOf("byro-repo"), "rev-parse", "master")).toBe(
        git(primaryOf("byro-repo"), "rev-parse", "master"),
      );
      expect(result.completed).toEqual([
        "clean-check",
        "files-changed",
        "log-row",
        "fast-forward",
        "secret-scan",
        "push",
        "delete-branches",
        "remove-workspace",
        "close",
        "parent-check",
      ]);
      expect(existsSync(workspace.path)).toBe(false);
      expect(
        git(primaryOf("byro-repo"), "branch", "--list", "issue-218-*"),
      ).toBe("");
      expect(github.closed).toEqual([
        {
          issue: ticket,
          comment: [
            "Posted the addendum and retitled #246.",
            "",
            "GitHub writes:",
            "- comment on byronbroughten/byro-repo#213: Posted the addendum. https://github.com/byronbroughten/byro-repo/issues/213#issuecomment-1",
            "- edit of byronbroughten/byro-repo#246: Retitled it. https://github.com/byronbroughten/byro-repo/issues/246",
          ].join("\n"),
        },
      ]);
    });

    it("detaches and deletes the issue branch in every branched repo, removing the workspace", async () => {
      const workspace = await workspaceWith(["sheets-framework"]);
      writeAppliedFacts();

      const result = await wrapUp().run(ticket);

      expect(result.branchDeleteFailures).toEqual([]);
      expect(existsSync(workspace.path)).toBe(false);
      expect(
        git(primaryOf("sheets-framework"), "branch", "--list", "issue-218-*"),
      ).toBe("");
    });

    it("leaves another repo's issue branch with the same number alone", async () => {
      await workspaceWith();
      const framework = primaryOf("sheets-framework");
      git(framework, "branch", "issue-218-other-work");
      git(framework, "push", "origin", "issue-218-other-work");
      writeAppliedFacts();

      await wrapUp().run(ticket);

      expect(
        git(framework, "branch", "--list", "issue-218-other-work"),
      ).toContain("issue-218-other-work");
      expect(
        git(
          remoteOf("sheets-framework"),
          "branch",
          "--list",
          "issue-218-other-work",
        ),
      ).toContain("issue-218-other-work");
    });

    it("refuses uncommitted work in the workspace's root", async () => {
      const workspace = await workspaceWith();
      writeFileSync(join(workspace.path, "loose.ts"), "");
      writeAppliedFacts();

      expect(await failureOf(wrapUp().run(ticket))).toBe("dirty-tree");
    });

    it("resumes after a failed push and records the row once", async () => {
      await workspaceWith();
      writeAppliedFacts();
      const remote = remoteOf("byro-repo");
      renameSync(remote, `${remote}.gone`);

      expect(await failureOf(wrapUp().run(ticket))).toBe("network");
      const landed = git(primaryRoot, "rev-parse", "master");

      renameSync(`${remote}.gone`, remote);
      await wrapUp().run(ticket);

      expect(git(remote, "rev-parse", "master")).toBe(landed);
      expect(github.closed).toHaveLength(1);
    });
  });

  describe("failures", () => {
    it("aborts a conflicting merge, leaves master alone and puts the workspace back on its branch", async () => {
      const workspace = await workspaceWith();
      commitIn(workspace, "byro-repo", "README.md", "# from the branch\n");
      writeFileSync(join(primaryRoot, "README.md"), "# from master\n");
      git(primaryRoot, "commit", "-am", "Change the README on master");
      const masterBefore = git(primaryRoot, "rev-parse", "master");
      writeFacts();

      expect(await failureOf(wrapUp().run(ticket))).toBe("conflict");
      expect(git(primaryRoot, "rev-parse", "master")).toBe(masterBefore);
      expect(git(workspace.path, "branch", "--show-current")).toBe(
        "issue-218-wrap-up-script",
      );
      expect(git(workspace.path, "status", "--porcelain")).toBe("");
    });

    it("stops on red checks without touching master", async () => {
      const workspace = await workspaceWith();
      commitIn(workspace, "byro-repo", "RED", "");
      const masterBefore = git(primaryRoot, "rev-parse", "master");
      writeFacts();

      expect(await failureOf(wrapUp().run(ticket))).toBe("red-checks");
      expect(git(primaryRoot, "rev-parse", "master")).toBe(masterBefore);
      expect(git(workspace.path, "branch", "--show-current")).toBe(
        "issue-218-wrap-up-script",
      );
    });

    it("refuses to push a landing that adds a token-shaped line, keeping the landed master", async () => {
      const workspace = await workspaceWith(["sheets-framework"]);
      const key = `AIza${"x7".repeat(18).slice(0, 35)}`;
      commitIn(
        workspace,
        "sheets-framework",
        "keys.ts",
        `export const a = 1;\nexport const key = "${key}";\n`,
      );
      const remoteBefore = git(
        remoteOf("sheets-framework"),
        "rev-parse",
        "master",
      );
      writeFacts({
        branches: [
          { repo: "sheets-framework", branch: "issue-218-wrap-up-script" },
        ],
      });

      const failure = await wrapUp()
        .run(ticket)
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(WrapUpFailure);
      expect((failure as WrapUpFailure).kind).toBe("secret-scan");
      expect((failure as WrapUpFailure).message).toContain(
        "sheets-framework keys.ts:2",
      );
      expect((failure as WrapUpFailure).message).not.toContain(key);
      expect(git(remoteOf("sheets-framework"), "rev-parse", "master")).toBe(
        remoteBefore,
      );
      expect(subjectsOf("sheets-framework")[0]).toBe(
        "Merge issue-218-wrap-up-script into master (#218)",
      );
    });

    it("pushes on a rerun once the token-shaped line is removed from the landed master", async () => {
      const workspace = await workspaceWith();
      commitIn(
        workspace,
        "byro-repo",
        "keys.ts",
        `const key = "sk-ant-${"q9".repeat(12)}";\n`,
      );
      writeFacts();
      expect(await failureOf(wrapUp().run(ticket))).toBe("secret-scan");

      git(primaryRoot, "rm", "-q", "keys.ts");
      git(primaryRoot, "commit", "-m", "Drop the key");
      await wrapUp().run(ticket);

      expect(git(remoteOf("byro-repo"), "rev-parse", "master")).toBe(
        git(primaryRoot, "rev-parse", "master"),
      );
    });

    it("refuses a primary checkout that isn't on master", async () => {
      const workspace = await workspaceWith();
      commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
      git(primaryRoot, "switch", "-c", "elsewhere");
      writeFacts();

      expect(await failureOf(wrapUp().run(ticket))).toBe("foreign-branch");
    });

    it("refuses uncommitted work in the workspace", async () => {
      const workspace = await workspaceWith();
      commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
      writeFileSync(join(workspace.path, "loose.ts"), "");
      writeFacts();

      expect(await failureOf(wrapUp().run(ticket))).toBe("dirty-tree");
    });

    it("lands over a dirty primary whose changes the fast-forward leaves alone", async () => {
      const workspace = await workspaceWith();
      commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
      writeFileSync(join(primaryRoot, "README.md"), "# edited on master\n");
      writeFacts();

      await wrapUp().run(ticket);

      expect(readFileSync(join(primaryRoot, "README.md"), "utf8")).toBe(
        "# edited on master\n",
      );
      expect(existsSync(join(primaryRoot, "script.ts"))).toBe(true);
    });
  });

  describe("rerun", () => {
    it("skips the merges after a failed push and lands nothing twice", async () => {
      const workspace = await workspaceWith();
      commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
      writeFacts();
      const remote = remoteOf("byro-repo");
      renameSync(remote, `${remote}.gone`);

      expect(await failureOf(wrapUp().run(ticket))).toBe("network");
      const landed = git(primaryRoot, "rev-parse", "master");

      renameSync(`${remote}.gone`, remote);
      const result = await wrapUp().run(ticket);

      expect(git(primaryRoot, "rev-parse", "master")).toBe(landed);
      expect(git(remote, "rev-parse", "master")).toBe(landed);
      expect(result.completed).toEqual([
        "clean-check",
        "files-changed",
        "merges",
        "checks",
        "log-row",
        "fast-forward",
        "secret-scan",
        "push",
        "delete-branches",
        "remove-workspace",
        "close",
        "parent-check",
      ]);
    });

    it("lands a fix committed after red checks", async () => {
      const workspace = await workspaceWith();
      commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
      commitIn(workspace, "byro-repo", "RED", "");
      writeFacts();
      expect(await failureOf(wrapUp().run(ticket))).toBe("red-checks");

      git(workspace.path, "rm", "-q", "RED");
      git(workspace.path, "commit", "-m", "Fix the checks");
      await wrapUp().run(ticket);

      expect(subjectsOf("byro-repo").slice(0, 3)).toEqual([
        "Record the #218 outcome: Opus medium, 1 files, 150K → 90K, first-try pass.",
        "Merge issue-218-wrap-up-script into master (#218)",
        "Fix the checks",
      ]);
    });
  });
});
