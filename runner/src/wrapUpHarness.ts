// The fixture and helpers WrapUp's test files share; each file calls useWrapUpHarness() once at its top.

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

import { FactsFile, type WrapUpFacts } from "./FactsFile.ts";
import { FakeGitHub } from "./FakeGitHub.ts";
import { clonePathIn, git, GitFixture, rootCloneOnly } from "./GitFixture.ts";
import {
  type IssueRef,
  issueRef,
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
export { rootCloneOnly };
const redCheck: Command = ["sh", "-c", "test ! -f RED"];

export const ticket: IssueRef = { repo: "byro-repo", number: 218 };
export const spec: IssueRef = { repo: "byro-repo", number: 213 };
export const outcomePath =
  "docs/agents/outcomes/byro-repo-213/byro-repo-218.md";

export let temp: string;
export let primaryRoot: string;
export let github: FakeGitHub;
export let sleeps: number[];
let testFileClonePaths: Record<string, string>;

// Each harness owns the temp and primaryRoot its test files import, so a shared setup would hand them back through getters.
export function useWrapUpHarness(
  clones: Record<string, string> = clonePaths,
): void {
  // Real git runs alongside every other git-heavy test file, which slows a test past the 5s default.
  vi.setConfig({ testTimeout: 15_000 });
  testFileClonePaths = clones;
  let fixture: GitFixture;

  beforeAll(() => {
    fixture = GitFixture.init(testFileClonePaths, {
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
    clonePaths: testFileClonePaths,
    workspaceFolder: join(temp, "workspaces"),
    symlinkedFiles: [],
    async installDependencies() {},
    async issueTitle() {
      return "Wrap-up script";
    },
    removeCommand: "npm run issue:remove",
  };
}

export function wrapUp(overrides: Partial<WrapUpConfig> = {}): WrapUp {
  return WrapUp.init({
    workspaces: workspacesConfig(),
    github,
    githubOwner: "byronbroughten",
    developer: "byronbroughten",
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

export const session = "glossary-term";
export const noGitHub: WrapUpConfig["github"] = {
  async closeIssue() {
    throw new Error("A session landing closed an issue");
  },
  async bodyOf() {
    throw new Error("A session landing read an issue body");
  },
  async parentOf() {
    throw new Error("A session landing read a parent");
  },
  async subIssuesOf() {
    throw new Error("A session landing read sub-issues");
  },
  async labelsOf() {
    throw new Error("A session landing read labels");
  },
  async commentsOf() {
    throw new Error("A session landing read comments");
  },
  async authoredCommentsOf() {
    throw new Error("A session landing read comments");
  },
};

export function sessionWrapUp(): WrapUp {
  return wrapUp({ github: noGitHub });
}

export async function sessionWorkspace(): Promise<Workspace> {
  return IssueWorkspaces.init(workspacesConfig()).create({ session });
}

export function primaryOf(repo: keyof typeof clonePaths): string {
  return join(primaryRoot, clonePathIn(testFileClonePaths, repo));
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
  commitFileIn(
    join(workspace.path, clonePathIn(testFileClonePaths, repo)),
    file,
    content,
  );
}

export function commitFileIn(
  checkout: string,
  file: string,
  content: string,
): void {
  writeFileSync(join(checkout, file), content);
  git(checkout, "add", file);
  git(checkout, "commit", "-m", `Add ${file}`);
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

// A facts file as an older runner saved it, laid over writeFacts()'s defaults.
export function writeSavedFacts(saved: Record<string, unknown>): void {
  writeFacts();
  const path = join(temp, "state", `${issueRef.fileStemOf(ticket)}.facts.json`);
  const facts = JSON.parse(readFileSync(path, "utf8")) as object;
  writeFileSync(path, JSON.stringify({ ...facts, ...saved }));
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

export async function errorOf(run: Promise<unknown>): Promise<Error> {
  try {
    await run;
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error("Expected the wrap-up to fail");
}

export async function failureOf(
  run: Promise<unknown>,
): Promise<WrapUpFailureKind> {
  const error = await errorOf(run);
  if (error instanceof WrapUpFailure) return error.kind;
  throw error;
}
