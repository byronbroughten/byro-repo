// The fixture and helpers WrapUp's test files share; each file calls useWrapUpHarness() once at its top.

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";

import { FactsFile, type WrapUpFacts } from "./FactsFile.ts";
import { FakeGitHub } from "./FakeGitHub.ts";
import { git, GitFixture } from "./GitFixture.ts";
import {
  type IssueRef,
  IssueWorkspaces,
  type IssueWorkspacesConfig,
  type Workspace,
} from "./IssueWorkspaces.ts";
import { type Command } from "./runKnobs.ts";
import { WrapUp, type WrapUpConfig } from "./WrapUp.ts";
import { WrapUpFailure, type WrapUpFailureKind } from "./WrapUpFailure.ts";

// Each class's tests pick their own fixture repos and checks; matching SpecRun's is a coincidence, not a shared fact.
export const clonePaths = {
  "byro-repo": ".",
  "sheets-framework": "packages/framework",
};
const redCheck: Command = ["sh", "-c", "test ! -f RED"];

export const ticket: IssueRef = { repo: "byro-repo", number: 218 };
export const spec: IssueRef = { repo: "byro-repo", number: 213 };
export const outcomePath =
  "docs/agents/outcomes/byro-repo-213/byro-repo-218.md";

export let temp: string;
export let primaryRoot: string;
export let github: FakeGitHub;
export let sleeps: number[];

// Each harness owns the temp and primaryRoot its test files import, so a shared setup would hand them back through getters.
export function useWrapUpHarness(): void {
  // Real git runs alongside every other git-heavy test file, which slows a test past the 5s default.
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
    temp = realpathSync(mkdtempSync(join(tmpdir(), "wrap-up-")));
    primaryRoot = join(temp, "byro-repo");
    github = FakeGitHub.init();
    github.parents.set(ticket.number, {
      issue: spec,
      labels: [],
      subIssues: { total: 3, completed: 2 },
    });
    sleeps = [];
    fixture.copyTo(temp);
  });

  afterEach(() => {
    rmSync(temp, { recursive: true, force: true });
  });
}

export function workspacesConfig(): IssueWorkspacesConfig {
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

export function wrapUp(overrides: Partial<WrapUpConfig> = {}): WrapUp {
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

export function primaryOf(repo: keyof typeof clonePaths): string {
  return join(primaryRoot, clonePaths[repo]);
}

export function remoteOf(repo: keyof typeof clonePaths): string {
  return join(temp, "remotes", `${repo}.git`);
}

export async function workspaceWith(
  extraRepos: string[] = [],
  issue: IssueRef = ticket,
): Promise<Workspace> {
  return IssueWorkspaces.init(workspacesConfig()).create(issue, {
    slug: "wrap up script",
    extraRepos,
  });
}

export function commitIn(
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

export function writeFacts(facts: Partial<WrapUpFacts> = {}): void {
  const full: WrapUpFacts = {
    closingComment: "Landed the wrap-up script.",
    pair: "Opus medium",
    peakContext: [150_000, 90_000],
    reviewFixes: "none",
    ...facts,
  };
  FactsFile.init(join(temp, "state")).write(ticket, full);
}

export function commitRed(clone: string): void {
  writeFileSync(join(clone, "RED"), "");
  git(clone, "add", "RED");
  git(clone, "commit", "-m", "Turn master red");
}

export function subjectsOf(
  repo: keyof typeof clonePaths,
  ref = "master",
): string[] {
  return git(primaryOf(repo), "log", "--topo-order", "--format=%s", ref).split(
    "\n",
  );
}

export async function failureOf(
  run: Promise<unknown>,
): Promise<WrapUpFailureKind> {
  try {
    await run;
  } catch (error) {
    if (error instanceof WrapUpFailure) return error.kind;
    throw error;
  }
  throw new Error("Expected the wrap-up to fail");
}
