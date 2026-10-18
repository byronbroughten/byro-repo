import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  IssueWorkspaces,
  type IssueWorkspacesConfig,
  type LeaseHolder,
} from "./IssueWorkspaces.ts";

const clonePaths = {
  "byro-repo": ".",
  "sheets-framework": "packages/framework",
  utils: "packages/utils",
};

let temp: string;
let primaryRoot: string;
let installs: string[];
let titleLookups: number;

beforeEach(() => {
  temp = realpathSync(mkdtempSync(join(tmpdir(), "issue-workspaces-")));
  primaryRoot = join(temp, "byro-repo");
  installs = [];
  titleLookups = 0;
  buildPrimary();
});

afterEach(() => {
  rmSync(temp, { recursive: true, force: true });
});

function workspaces(
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

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
    { cwd, encoding: "utf8" },
  ).trim();
}

function buildPrimary(): void {
  Object.entries(clonePaths).forEach(([repo, clonePath]) => {
    const remote = join(temp, "remotes", `${repo}.git`);
    mkdirSync(remote, { recursive: true });
    git(remote, "init", "--bare", "-b", "master");
    const clone = join(primaryRoot, clonePath);
    mkdirSync(clone, { recursive: true });
    git(clone, "init", "-b", "master");
    git(clone, "remote", "add", "origin", remote);
    const ignored =
      repo === "byro-repo"
        ? "node_modules/\npackages/*\n"
        : "node_modules/\nsheets.config.json\n.clasp.json\n";
    writeFileSync(join(clone, ".gitignore"), ignored);
    writeFileSync(join(clone, "README.md"), `# ${repo}\n`);
    git(clone, "add", ".");
    git(clone, "commit", "-m", "Initial commit");
    git(clone, "push", "-u", "origin", "master");
  });
  writeFileSync(
    join(primaryRoot, "packages/framework/sheets.config.json"),
    "{}",
  );
  writeFileSync(join(primaryRoot, "packages/framework/.clasp.json"), "{}");
  mkdirSync(join(primaryRoot, "node_modules/dep"), { recursive: true });
  writeFileSync(join(primaryRoot, "node_modules/dep/index.js"), "root dep");
  mkdirSync(join(primaryRoot, "packages/utils/node_modules/dep"), {
    recursive: true,
  });
  writeFileSync(
    join(primaryRoot, "packages/utils/node_modules/dep/index.js"),
    "utils dep",
  );
}

// Untracked, as the root lockfile is gitignored.
function writeLockfile(content: string): void {
  writeFileSync(join(primaryRoot, "package-lock.json"), content);
}

function writeHiddenLockfile(ageSeconds: number): void {
  const hidden = join(primaryRoot, "node_modules/.package-lock.json");
  writeFileSync(hidden, "hidden lock");
  const lockfileTime = statSync(join(primaryRoot, "package-lock.json")).mtime;
  const time = new Date(lockfileTime.getTime() - ageSeconds * 1000);
  utimesSync(hidden, time, time);
}

function branchOf(path: string): string | undefined {
  const branch = git(path, "branch", "--show-current");
  return branch === "" ? undefined : branch;
}

function primaryStates(): string[] {
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

function registeredWorktrees(): string[] {
  return Object.values(clonePaths).flatMap((clonePath) =>
    git(join(primaryRoot, clonePath), "worktree", "list", "--porcelain")
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length))
      .filter((path) => path.startsWith(join(temp, "workspaces"))),
  );
}

describe("create", () => {
  it("puts the issue's repo on the issue branch and detaches every other repo at master", async () => {
    const before = primaryStates();
    const workspace = await workspaces().create({
      repo: "sheets-framework",
      number: 48,
    });

    const root = join(
      temp,
      "workspaces/sheets-framework-issue-48-workspace-module-create-list-and-remove",
    );
    expect(workspace.path).toBe(root);
    expect(branchOf(join(root, "packages/framework"))).toBe(
      "issue-48-workspace-module-create-list-and-remove",
    );
    expect(branchOf(root)).toBeUndefined();
    expect(branchOf(join(root, "packages/utils"))).toBeUndefined();
    expect(git(root, "rev-parse", "HEAD")).toBe(
      git(primaryRoot, "rev-parse", "master"),
    );
    expect(workspace.branchedRepos).toEqual(["sheets-framework"]);
    expect(primaryStates()).toEqual(before);
  });
});

describe("a session workspace", () => {
  it("puts every repo on session-<slug>, in the same workspace folder, with no title lookup, since that is a gh call", async () => {
    const before = primaryStates();
    const workspace = await workspaces().create({ session: "glossary-fix" });

    const root = join(temp, "workspaces/session-glossary-fix");
    expect(workspace.path).toBe(root);
    expect(workspace.branch).toBe("session-glossary-fix");
    Object.values(clonePaths).forEach((clonePath) => {
      expect(branchOf(join(root, clonePath))).toBe("session-glossary-fix");
    });
    expect(workspace.branchedRepos).toEqual([
      "byro-repo",
      "utils",
      "sheets-framework",
    ]);
    expect(titleLookups).toBe(0);
    expect(primaryStates()).toEqual(before);
  });

  it("refuses a slug or extra repos, which only an issue workspace takes", async () => {
    await expect(
      workspaces().create({ session: "glossary-fix" }, { slug: "other" }),
    ).rejects.toThrow(/issue workspace/);
    await expect(
      workspaces().create(
        { session: "glossary-fix" },
        { extraRepos: ["utils"] },
      ),
    ).rejects.toThrow(/issue workspace/);
    expect(await workspaces().list()).toEqual([]);
  });

  it("refuses a session key that isn't a slug", async () => {
    await expect(
      workspaces().create({ session: "Glossary Fix" }),
    ).rejects.toThrow(/Glossary Fix/);
    expect(await workspaces().list()).toEqual([]);
  });

  it("is found and listed beside issue workspaces by its key", async () => {
    await workspaces().create({ repo: "byro-repo", number: 7 }, { slug: "x" });
    const session = await workspaces().create({ session: "glossary-fix" });
    writeFileSync(join(session.path, "packages/utils/new.txt"), "untracked");

    const found = await workspaces().find({ session: "glossary-fix" });
    const listed = await workspaces().list();

    expect(found?.path).toBe(session.path);
    expect(found?.dirtyRepos).toEqual(["utils"]);
    expect(await workspaces().find({ session: "other" })).toBeUndefined();
    expect(listed.map(({ key, branch }) => ({ key, branch }))).toEqual([
      { key: { repo: "byro-repo", number: 7 }, branch: "issue-7-x" },
      { key: { session: "glossary-fix" }, branch: "session-glossary-fix" },
    ]);
  });

  it("resumes, leaving its work in place", async () => {
    const workspace = await workspaces().create({ session: "glossary-fix" });
    writeFileSync(join(workspace.path, "README.md"), "edited");

    await workspaces().resume(workspace);

    expect(readFileSync(join(workspace.path, "README.md"), "utf8")).toBe(
      "edited",
    );
    expect(branchOf(workspace.path)).toBe("session-glossary-fix");
  });

  it("is removed when clean, keeping its branches, and refused when dirty without force", async () => {
    const workspace = await workspaces().create({ session: "glossary-fix" });
    writeFileSync(join(workspace.path, "README.md"), "edited");

    await expect(workspaces().remove(workspace)).rejects.toThrow(/byro-repo/);
    expect(existsSync(workspace.path)).toBe(true);

    git(workspace.path, "commit", "-am", "Session work");
    await workspaces().remove(workspace);

    expect(existsSync(workspace.path)).toBe(false);
    expect(registeredWorktrees()).toEqual([]);
    expect(
      git(primaryRoot, "branch", "--list", "session-glossary-fix"),
    ).toContain("session-glossary-fix");
  });

  it("is rebuilt on its kept branch after a remove", async () => {
    const first = await workspaces().create({ session: "glossary-fix" });
    writeFileSync(join(first.path, "kept.txt"), "kept");
    git(first.path, "add", "kept.txt");
    git(first.path, "commit", "-m", "Session work");
    await workspaces().remove(first);

    const second = await workspaces().create({ session: "glossary-fix" });

    expect(readFileSync(join(second.path, "kept.txt"), "utf8")).toBe("kept");
  });
});

describe("start", () => {
  it("creates a workspace that doesn't exist, for either key", async () => {
    const issue = await workspaces().start({ repo: "byro-repo", number: 7 });
    const session = await workspaces().start({ session: "glossary-fix" });

    expect(issue.branch).toBe(
      "issue-7-workspace-module-create-list-and-remove",
    );
    expect(branchOf(issue.path)).toBe(issue.branch);
    expect(session.branch).toBe("session-glossary-fix");
    expect(installs).toEqual([issue.path, session.path]);
  });

  it("gives an issue workspace the branch create would", async () => {
    const started = await workspaces().start({ repo: "utils", number: 48 });
    await workspaces().remove(started);
    git(join(primaryRoot, "packages/utils"), "branch", "-D", started.branch);

    const created = await workspaces().create({ repo: "utils", number: 48 });

    expect(started.branch).toBe(created.branch);
    expect(started.path).toBe(created.path);
  });

  it("resumes an existing issue workspace, moving its detached repos to master", async () => {
    const created = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "spans" },
    );
    const newerUtils = advanceMaster("packages/utils", "newer.txt");

    const started = await workspaces().start({ repo: "byro-repo", number: 7 });

    expect(started.path).toBe(created.path);
    expect(git(join(created.path, "packages/utils"), "rev-parse", "HEAD")).toBe(
      newerUtils,
    );
  });

  it("resumes an existing session workspace, keeping its work", async () => {
    const created = await workspaces().create({ session: "glossary-fix" });
    writeFileSync(join(created.path, "work.txt"), "in progress");

    const started = await workspaces().start({ session: "glossary-fix" });

    expect(started.path).toBe(created.path);
    expect(readFileSync(join(created.path, "work.txt"), "utf8")).toBe(
      "in progress",
    );
  });
});

describe("the branch name", () => {
  it("reuses an existing issue branch in any repo, without asking for the title", async () => {
    git(
      join(primaryRoot, "packages/utils"),
      "branch",
      "issue-48-earlier-start",
    );
    const workspace = await workspaces().create(
      { repo: "sheets-framework", number: 48 },
      { slug: "ignored" },
    );

    expect(workspace.branch).toBe("issue-48-earlier-start");
    expect(branchOf(join(workspace.path, "packages/framework"))).toBe(
      "issue-48-earlier-start",
    );
    expect(titleLookups).toBe(0);
  });

  it("reuses an issue branch that only exists on the remote", async () => {
    const utils = join(primaryRoot, "packages/utils");
    git(utils, "branch", "issue-48-pushed");
    git(utils, "push", "origin", "issue-48-pushed");
    git(utils, "branch", "-D", "issue-48-pushed");
    const workspace = await workspaces().create({ repo: "utils", number: 48 });

    expect(branchOf(join(workspace.path, "packages/utils"))).toBe(
      "issue-48-pushed",
    );
  });

  it("takes an explicit slug over the issue title", async () => {
    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "Short Name" },
    );

    expect(workspace.path).toBe(
      join(temp, "workspaces/byro-repo-issue-7-short-name"),
    );
    expect(branchOf(workspace.path)).toBe("issue-7-short-name");
    expect(titleLookups).toBe(0);
  });

  it("puts named extra repos on the branch too", async () => {
    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "spans", extraRepos: ["utils"] },
    );

    expect(branchOf(workspace.path)).toBe("issue-7-spans");
    expect(branchOf(join(workspace.path, "packages/utils"))).toBe(
      "issue-7-spans",
    );
    expect(
      branchOf(join(workspace.path, "packages/framework")),
    ).toBeUndefined();
    expect(workspace.branchedRepos).toEqual(["byro-repo", "utils"]);
  });
});

describe("promote", () => {
  it("puts a detached repo on the issue branch, keeping its edits and leaving the primaries alone", async () => {
    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "spans" },
    );
    const utils = join(workspace.path, "packages/utils");
    writeFileSync(join(utils, "README.md"), "edited");
    const before = primaryStates();

    const promoted = await workspaces().promote(workspace, "utils");

    expect(branchOf(utils)).toBe("issue-7-spans");
    expect(readFileSync(join(utils, "README.md"), "utf8")).toBe("edited");
    expect(promoted.branchedRepos).toEqual(["byro-repo", "utils"]);
    expect(
      branchOf(join(workspace.path, "packages/framework")),
    ).toBeUndefined();
    expect(primaryStates()).toEqual(before);
  });

  it("reuses the branch when the repo already has it", async () => {
    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "spans" },
    );
    const primaryUtils = join(primaryRoot, "packages/utils");
    git(primaryUtils, "branch", "issue-7-spans");
    writeFileSync(join(primaryUtils, "extra.txt"), "on the branch");
    git(primaryUtils, "switch", "issue-7-spans");
    git(primaryUtils, "add", "extra.txt");
    git(primaryUtils, "commit", "-m", "Earlier work");
    git(primaryUtils, "switch", "master");

    await workspaces().promote(workspace, "utils");

    const utils = join(workspace.path, "packages/utils");
    expect(branchOf(utils)).toBe("issue-7-spans");
    expect(readFileSync(join(utils, "extra.txt"), "utf8")).toBe(
      "on the branch",
    );
  });

  it("reuses a branch the repo has only on its remote", async () => {
    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "spans" },
    );
    const primaryUtils = join(primaryRoot, "packages/utils");
    git(primaryUtils, "branch", "issue-7-spans");
    git(primaryUtils, "push", "origin", "issue-7-spans");
    git(primaryUtils, "branch", "-D", "issue-7-spans");

    await workspaces().promote(workspace, "utils");

    expect(branchOf(join(workspace.path, "packages/utils"))).toBe(
      "issue-7-spans",
    );
  });

  it("refuses a repo that is on some other branch, changing nothing", async () => {
    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "spans" },
    );
    const utils = join(workspace.path, "packages/utils");
    git(utils, "switch", "-c", "scratch");

    await expect(workspaces().promote(workspace, "utils")).rejects.toThrow(
      /scratch/,
    );
    expect(branchOf(utils)).toBe("scratch");
  });

  it("is a no-op for a repo already on the issue branch", async () => {
    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "spans", extraRepos: ["utils"] },
    );
    const utils = join(workspace.path, "packages/utils");
    writeFileSync(join(utils, "work.txt"), "in progress");
    const head = git(utils, "rev-parse", "HEAD");

    const promoted = await workspaces().promote(workspace, "utils");

    expect(branchOf(utils)).toBe("issue-7-spans");
    expect(git(utils, "rev-parse", "HEAD")).toBe(head);
    expect(readFileSync(join(utils, "work.txt"), "utf8")).toBe("in progress");
    expect(promoted.branchedRepos).toEqual(["byro-repo", "utils"]);
  });
});

function advanceMaster(clonePath: string, file: string): string {
  const clone = join(primaryRoot, clonePath);
  writeFileSync(join(clone, file), "newer");
  git(clone, "add", file);
  git(clone, "commit", "-m", `Add ${file}`);
  return git(clone, "rev-parse", "HEAD");
}

describe("resume", () => {
  it("moves each clean detached repo to the primary's current master and leaves repos on the issue branch alone", async () => {
    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "spans" },
    );
    const framework = join(workspace.path, "packages/framework");
    const rootHead = git(workspace.path, "rev-parse", "HEAD");
    const newerFramework = advanceMaster("packages/framework", "newer.txt");
    advanceMaster(".", "newer.txt");
    const before = primaryStates();

    await workspaces().resume(workspace);

    expect(branchOf(framework)).toBeUndefined();
    expect(git(framework, "rev-parse", "HEAD")).toBe(newerFramework);
    expect(readFileSync(join(framework, "newer.txt"), "utf8")).toBe("newer");
    expect(branchOf(workspace.path)).toBe("issue-7-spans");
    expect(git(workspace.path, "rev-parse", "HEAD")).toBe(rootHead);
    expect(primaryStates()).toEqual(before);
  });

  it("fails naming each dirty detached repo and changes nothing", async () => {
    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "spans" },
    );
    const framework = join(workspace.path, "packages/framework");
    const utils = join(workspace.path, "packages/utils");
    const headsBefore = [framework, utils].map((worktree) =>
      git(worktree, "rev-parse", "HEAD"),
    );
    writeFileSync(join(framework, "README.md"), "edited");
    writeFileSync(join(utils, "new.txt"), "untracked");
    advanceMaster("packages/framework", "newer.txt");
    advanceMaster("packages/utils", "newer.txt");
    writeFileSync(join(workspace.path, "README.md"), "edited on the branch");

    const failure = workspaces().resume(workspace);
    await expect(failure).rejects.toThrow(/sheets-framework/);
    await expect(failure).rejects.toThrow(/utils/);

    expect(
      [framework, utils].map((worktree) => git(worktree, "rev-parse", "HEAD")),
    ).toEqual(headsBefore);
    expect(readFileSync(join(framework, "README.md"), "utf8")).toBe("edited");
    expect(readFileSync(join(utils, "new.txt"), "utf8")).toBe("untracked");
    expect(existsSync(join(utils, "newer.txt"))).toBe(false);
  });

  it("fails naming a detached repo whose commits are on no branch, changing nothing", async () => {
    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "spans" },
    );
    const utils = join(workspace.path, "packages/utils");
    writeFileSync(join(utils, "kept.txt"), "committed");
    git(utils, "add", "kept.txt");
    git(utils, "commit", "-m", "Detached work");
    const head = git(utils, "rev-parse", "HEAD");
    advanceMaster("packages/utils", "newer.txt");

    await expect(workspaces().resume(workspace)).rejects.toThrow(
      /commits on no branch in utils/,
    );

    expect(git(utils, "rev-parse", "HEAD")).toBe(head);
    expect(branchOf(utils)).toBeUndefined();
  });

  it("resumes a detached repo whose commits are on a branch, such as one behind master", async () => {
    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "spans" },
    );
    const utils = join(workspace.path, "packages/utils");
    const newerUtils = advanceMaster("packages/utils", "newer.txt");
    git(utils, "switch", "--detach", newerUtils);
    const primaryUtils = join(primaryRoot, "packages/utils");
    git(primaryUtils, "branch", "saved", newerUtils);
    advanceMaster("packages/utils", "newest.txt");

    await workspaces().resume(workspace);

    expect(git(utils, "rev-parse", "HEAD")).toBe(
      git(primaryUtils, "rev-parse", "master"),
    );
  });

  it("keeps the commits when the repo is promoted first", async () => {
    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "spans" },
    );
    const utils = join(workspace.path, "packages/utils");
    writeFileSync(join(utils, "kept.txt"), "committed");
    git(utils, "add", "kept.txt");
    git(utils, "commit", "-m", "Detached work");
    const head = git(utils, "rev-parse", "HEAD");

    await workspaces().promote(workspace, "utils");
    await workspaces().resume(workspace);

    expect(git(utils, "rev-parse", "HEAD")).toBe(head);
    expect(branchOf(utils)).toBe("issue-7-spans");
  });

  it("does not count a dirty repo on the issue branch against resuming", async () => {
    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "spans" },
    );
    writeFileSync(join(workspace.path, "README.md"), "edited on the branch");
    const newerUtils = advanceMaster("packages/utils", "newer.txt");

    await workspaces().resume(workspace);

    expect(
      git(join(workspace.path, "packages/utils"), "rev-parse", "HEAD"),
    ).toBe(newerUtils);
    expect(readFileSync(join(workspace.path, "README.md"), "utf8")).toBe(
      "edited on the branch",
    );
  });
});

describe("create, a second time", () => {
  it("returns the existing workspace unchanged", async () => {
    const first = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "first" },
    );
    writeFileSync(join(first.path, "work.txt"), "in progress");
    const second = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "second", extraRepos: ["utils"] },
    );

    expect(second).toEqual(first);
    expect(readFileSync(join(first.path, "work.txt"), "utf8")).toBe(
      "in progress",
    );
    expect(branchOf(join(first.path, "packages/utils"))).toBeUndefined();
    expect(installs).toHaveLength(1);
  });
});

describe("create, when a step fails", () => {
  it("rolls back, leaving no folder or registered worktree, so the next create starts afresh", async () => {
    const failing = workspaces({
      async installDependencies() {
        throw new Error("npm install failed");
      },
    });

    await expect(
      failing.create({ repo: "byro-repo", number: 7 }, { slug: "fails" }),
    ).rejects.toThrow("npm install failed");
    expect(await workspaces().list()).toEqual([]);
    expect(registeredWorktrees()).toEqual([]);

    const retried = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "fails" },
    );
    expect(installs).toEqual([retried.path]);
  });
});

describe("the shared files", () => {
  it("symlinks each listed file from the primary clone that has it, and nothing else", async () => {
    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "links" },
    );
    const framework = join(workspace.path, "packages/framework");

    ["sheets.config.json", ".clasp.json"].forEach((file) => {
      expect(lstatSync(join(framework, file)).isSymbolicLink()).toBe(true);
      expect(realpathSync(join(framework, file))).toBe(
        join(primaryRoot, "packages/framework", file),
      );
    });
    expect(existsSync(join(workspace.path, "packages/utils/.clasp.json"))).toBe(
      false,
    );
    expect(existsSync(join(workspace.path, "sheets.config.json"))).toBe(false);
  });
});

describe("the dependencies", () => {
  it("seeds each node_modules as a copy, not a link, then runs the installer in the workspace", async () => {
    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "deps" },
    );

    const rootDep = join(workspace.path, "node_modules/dep/index.js");
    const utilsModules = join(workspace.path, "packages/utils/node_modules");
    expect(readFileSync(rootDep, "utf8")).toBe("root dep");
    expect(
      lstatSync(join(workspace.path, "node_modules")).isSymbolicLink(),
    ).toBe(false);
    expect(lstatSync(utilsModules).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(utilsModules, "dep/index.js"), "utf8")).toBe(
      "utils dep",
    );
    expect(installs).toEqual([workspace.path]);
  });

  it("copies the primary's lockfile into the workspace byte for byte", async () => {
    writeLockfile("lock v1");

    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "lockfile" },
    );

    expect(readFileSync(join(workspace.path, "package-lock.json"))).toEqual(
      readFileSync(join(primaryRoot, "package-lock.json")),
    );
  });

  it("runs the installer when the primary has no lockfile", async () => {
    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "no-lockfile" },
    );

    expect(existsSync(join(workspace.path, "package-lock.json"))).toBe(false);
    expect(installs).toEqual([workspace.path]);
  });

  it("skips the installer when the primary's install is fresh and every copy worked", async () => {
    writeLockfile("lock v1");
    writeHiddenLockfile(-60);

    await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "matching" },
    );

    expect(installs).toEqual([]);
  });

  it("runs the installer when the primary's hidden lockfile is older than its lockfile", async () => {
    writeLockfile("lock v1");
    writeHiddenLockfile(60);

    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "stale-primary" },
    );

    expect(installs).toEqual([workspace.path]);
  });

  it("runs the installer when the primary has no hidden lockfile", async () => {
    writeLockfile("lock v1");

    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "no-hidden-lockfile" },
    );

    expect(installs).toEqual([workspace.path]);
  });

  it("runs the installer when a copy failed", async () => {
    writeLockfile("lock v1");
    writeHiddenLockfile(-60);
    const unreadable = join(primaryRoot, "packages/utils/node_modules/dep");
    chmodSync(unreadable, 0o000);
    try {
      const workspace = await workspaces().create(
        { repo: "byro-repo", number: 7 },
        { slug: "failed-copy" },
      );

      expect(installs).toEqual([workspace.path]);
    } finally {
      chmodSync(unreadable, 0o755);
    }
  });
});

describe("list", () => {
  it("reports each workspace's issue, branched repos, dirty repos and creation time", async () => {
    const started = Date.now();
    await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "clean", extraRepos: ["utils"] },
    );
    const dirty = await workspaces().create(
      { repo: "sheets-framework", number: 48 },
      { slug: "dirty" },
    );
    writeFileSync(join(dirty.path, "packages/framework/README.md"), "edited");

    const listed = await workspaces().list();

    expect(
      listed.map(({ key, branch, branchedRepos, dirtyRepos }) => ({
        key,
        branch,
        branchedRepos,
        dirtyRepos,
      })),
    ).toEqual([
      {
        key: { repo: "byro-repo", number: 7 },
        branch: "issue-7-clean",
        branchedRepos: ["byro-repo", "utils"],
        dirtyRepos: [],
      },
      {
        key: { repo: "sheets-framework", number: 48 },
        branch: "issue-48-dirty",
        branchedRepos: ["sheets-framework"],
        dirtyRepos: ["sheets-framework"],
      },
    ]);
    listed.forEach((workspace) => {
      expect(workspace.createdAt.getTime()).toBeGreaterThanOrEqual(
        started - 1000,
      );
    });
  });

  it("is empty before any workspace exists", async () => {
    expect(await workspaces().list()).toEqual([]);
  });
});

// The test runner's parent outlives every test, so it stands in for another live holder.
const liveSession: LeaseHolder = { kind: "session", pid: process.ppid };

function deadPid(): number {
  const { pid } = spawnSync("node", ["-e", ""]);
  if (pid === undefined) throw new Error("The throwaway process didn't start");
  return pid;
}

describe("a lease", () => {
  it("is taken, read back with its holder live, and leaves the workspace clean", async () => {
    const workspace = await workspaces().create({ session: "glossary-fix" });

    await workspaces().takeLease(workspace, liveSession);

    expect(await workspaces().leaseOf(workspace)).toEqual({
      ...liveSession,
      isLive: true,
    });
    const found = await workspaces().find({ session: "glossary-fix" });
    expect(found?.lease).toEqual({ ...liveSession, isLive: true });
    expect(found?.dirtyRepos).toEqual([]);
  });

  it("is refused to another holder while its holder lives, naming the holder, and re-taken by its own", async () => {
    const workspace = await workspaces().create({ session: "glossary-fix" });
    await workspaces().takeLease(workspace, liveSession);

    await expect(
      workspaces().takeLease(workspace, { kind: "run", pid: process.pid }),
    ).rejects.toThrow(`a session (pid ${process.ppid})`);
    await workspaces().takeLease(workspace, liveSession);
    expect(await workspaces().leaseOf(workspace)).toMatchObject(liveSession);
  });

  it("is read as abandoned once its holder dies, and taken over", async () => {
    const workspace = await workspaces().create({ session: "glossary-fix" });
    const dead: LeaseHolder = { kind: "session", pid: deadPid() };
    await workspaces().takeLease(workspace, dead);

    expect(await workspaces().leaseOf(workspace)).toEqual({
      ...dead,
      isLive: false,
    });
    await workspaces().takeLease(workspace, { kind: "run", pid: process.pid });
    expect(await workspaces().leaseOf(workspace)).toEqual({
      kind: "run",
      pid: process.pid,
      isLive: true,
    });
  });

  it("is read as abandoned when its process ID now belongs to a process started since", async () => {
    const workspace = await workspaces().create({ session: "glossary-fix" });
    await workspaces().takeLease(workspace, liveSession);
    const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
      cwd: workspace.path,
      encoding: "utf8",
    }).trim();
    const leasePath = join(gitDir, "workspace.lease");
    const lease = JSON.parse(readFileSync(leasePath, "utf8")) as object;
    writeFileSync(
      leasePath,
      JSON.stringify({ ...lease, startedAt: "Thu Jan  1 00:00:00 1970" }),
    );

    expect(await workspaces().leaseOf(workspace)).toEqual({
      ...liveSession,
      isLive: false,
    });
  });

  it("is released", async () => {
    const workspace = await workspaces().create({ session: "glossary-fix" });
    await workspaces().takeLease(workspace, liveSession);

    await workspaces().releaseLease(workspace);

    expect(await workspaces().leaseOf(workspace)).toBeUndefined();
    await workspaces().takeLease(workspace, { kind: "run", pid: process.pid });
  });

  it("is listed with its workspace by leases(), which skips a workspace with none", async () => {
    const key = { session: "glossary-fix" };
    const leased = await workspaces().create(key);
    await workspaces().create({ session: "unleased" });
    await workspaces().takeLease(leased, liveSession);

    expect(await workspaces().leases()).toEqual([
      { path: leased.path, key, lease: { ...liveSession, isLive: true } },
    ]);
  });

  it("keeps start from resuming the workspace for anyone but its holder", async () => {
    const key = { repo: "byro-repo", number: 7 };
    const workspace = await workspaces().create(key, { slug: "leased" });
    await workspaces().takeLease(workspace, liveSession);

    await expect(workspaces().start(key)).rejects.toThrow(
      `a session (pid ${process.ppid})`,
    );
    expect((await workspaces().start(key, liveSession)).path).toBe(
      workspace.path,
    );
  });

  it("is taken by start for the holder it names", async () => {
    const workspace = await workspaces().start(
      { session: "glossary-fix" },
      liveSession,
    );

    expect(await workspaces().leaseOf(workspace)).toMatchObject(liveSession);
  });

  it("keeps remove from removing the workspace, even with force, until it is released or its holder dies", async () => {
    const workspace = await workspaces().create({ session: "glossary-fix" });
    await workspaces().takeLease(workspace, liveSession);

    await expect(
      workspaces().remove(workspace, { force: true }),
    ).rejects.toThrow(`a session (pid ${process.ppid})`);
    expect(existsSync(workspace.path)).toBe(true);

    await workspaces().releaseLease(workspace);
    await workspaces().remove(workspace);
    expect(existsSync(workspace.path)).toBe(false);
  });

  it("leaves remove free once its holder dies", async () => {
    const workspace = await workspaces().create({ session: "glossary-fix" });
    await workspaces().takeLease(workspace, {
      kind: "session",
      pid: deadPid(),
    });

    await workspaces().remove(workspace);

    expect(existsSync(workspace.path)).toBe(false);
  });
});

describe("remove", () => {
  it("refuses a dirty workspace without force and leaves it in place", async () => {
    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "dirty" },
    );
    writeFileSync(join(workspace.path, "packages/utils/new.txt"), "untracked");

    await expect(workspaces().remove(workspace)).rejects.toThrow(/utils/);
    expect(existsSync(join(workspace.path, "packages/utils/new.txt"))).toBe(
      true,
    );
    expect(registeredWorktrees()).toHaveLength(3);
  });

  it("refuses a workspace holding commits on no branch without force, and removes it with force", async () => {
    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "orphaned" },
    );
    const utils = join(workspace.path, "packages/utils");
    writeFileSync(join(utils, "kept.txt"), "committed");
    git(utils, "add", "kept.txt");
    git(utils, "commit", "-m", "Detached work");

    await expect(workspaces().remove(workspace)).rejects.toThrow(
      /commits on no branch in utils/,
    );
    expect(existsSync(utils)).toBe(true);

    await workspaces().remove(workspace, { force: true });
    expect(existsSync(workspace.path)).toBe(false);
  });

  it("removes a clean workspace, leaving no worktree registered and the primaries untouched", async () => {
    const before = primaryStates();
    const workspace = await workspaces().create(
      { repo: "sheets-framework", number: 48 },
      { slug: "clean" },
    );

    await workspaces().remove(workspace);

    expect(existsSync(workspace.path)).toBe(false);
    expect(registeredWorktrees()).toEqual([]);
    expect(await workspaces().list()).toEqual([]);
    expect(primaryStates()).toEqual(before);
    expect(
      readFileSync(
        join(primaryRoot, "packages/framework/sheets.config.json"),
        "utf8",
      ),
    ).toBe("{}");
  });

  it("removes a dirty workspace with force", async () => {
    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "forced" },
    );
    writeFileSync(join(workspace.path, "README.md"), "edited");
    writeFileSync(join(workspace.path, "packages/utils/new.txt"), "untracked");

    await workspaces().remove(workspace, { force: true });

    expect(existsSync(workspace.path)).toBe(false);
    expect(registeredWorktrees()).toEqual([]);
  });
});
