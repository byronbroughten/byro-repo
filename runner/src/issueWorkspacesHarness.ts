// The fixture and helpers IssueWorkspaces' test files share; each file calls useIssueWorkspacesHarness() once at its top.

import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";

import { git, GitFixture } from "./GitFixture.ts";
import {
  IssueWorkspaces,
  type IssueWorkspacesConfig,
} from "./IssueWorkspaces.ts";

export const clonePaths = {
  "byro-repo": ".",
  "sheets-framework": "packages/framework",
  utils: "packages/utils",
};

export let temp: string;
export let primaryRoot: string;
export let installs: string[];
export let titleLookups: number;

export function useIssueWorkspacesHarness(): void {
  // Real git runs alongside every other git-heavy test file, which slows a test past the 5s default.
  vi.setConfig({ testTimeout: 15_000 });
  let fixture: GitFixture;

  beforeAll(() => {
    fixture = GitFixture.init(clonePaths, {
      gitignoreOf: (repo) =>
        repo === "byro-repo"
          ? "node_modules/\npackages/*\n"
          : "node_modules/\nsheets.config.json\n.clasp.json\n",
      addUntracked: writeUntracked,
    });
  });

  afterAll(() => {
    fixture.remove();
  });

  beforeEach(() => {
    temp = realpathSync(mkdtempSync(join(tmpdir(), "issue-workspaces-")));
    primaryRoot = join(temp, "byro-repo");
    installs = [];
    titleLookups = 0;
    fixture.copyTo(temp);
  });

  afterEach(() => {
    rmSync(temp, { recursive: true, force: true });
  });
}

function writeUntracked(root: string): void {
  writeFileSync(join(root, "packages/framework/sheets.config.json"), "{}");
  writeFileSync(join(root, "packages/framework/.clasp.json"), "{}");
  mkdirSync(join(root, "node_modules/dep"), { recursive: true });
  writeFileSync(join(root, "node_modules/dep/index.js"), "root dep");
  mkdirSync(join(root, "packages/utils/node_modules/dep"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "packages/utils/node_modules/dep/index.js"),
    "utils dep",
  );
}

export function workspaces(
  overrides: Partial<IssueWorkspacesConfig> = {},
): IssueWorkspaces {
  return IssueWorkspaces.init({
    primaryRoot,
    clonePaths,
    workspaceFolder: join(temp, "workspaces"),
    symlinkedFiles: ["sheets.config.json", ".clasp.json"],
    async installDependencies(workspaceRoot) {
      installs.push(workspaceRoot);
    },
    async issueTitle() {
      titleLookups += 1;
      return "Workspace module: create, list and remove";
    },
    ...overrides,
  });
}

// Untracked, as the root lockfile is gitignored.
export function writeLockfile(content: string): void {
  writeFileSync(join(primaryRoot, "package-lock.json"), content);
}

export function writeHiddenLockfile(ageSeconds: number): void {
  const hidden = join(primaryRoot, "node_modules/.package-lock.json");
  writeFileSync(hidden, "hidden lock");
  const lockfileTime = statSync(join(primaryRoot, "package-lock.json")).mtime;
  const time = new Date(lockfileTime.getTime() - ageSeconds * 1000);
  utimesSync(hidden, time, time);
}

export function branchOf(path: string): string | undefined {
  const branch = git(path, "branch", "--show-current");
  return branch === "" ? undefined : branch;
}

export function primaryStates(): string[] {
  return Object.values(clonePaths).map((clonePath) => {
    const clone = join(primaryRoot, clonePath);
    return [
      clonePath,
      branchOf(clone),
      git(clone, "rev-parse", "HEAD"),
      git(clone, "status", "--porcelain", "--untracked-files=no"),
    ].join(" ");
  });
}

export function registeredWorktrees(): string[] {
  return Object.values(clonePaths).flatMap((clonePath) =>
    git(join(primaryRoot, clonePath), "worktree", "list", "--porcelain")
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length))
      .filter((path) => path.startsWith(join(temp, "workspaces"))),
  );
}

export function advanceMaster(clonePath: string, file: string): string {
  const clone = join(primaryRoot, clonePath);
  writeFileSync(join(clone, file), "newer");
  git(clone, "add", file);
  git(clone, "commit", "-m", `Add ${file}`);
  return git(clone, "rev-parse", "HEAD");
}
