import {
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { git } from "./GitFixture.ts";
import {
  advanceMaster,
  branchOf,
  clonePaths,
  primaryRoot,
  primaryStates,
  useIssueWorkspacesHarness,
  workspaces,
} from "./issueWorkspacesHarness.ts";

useIssueWorkspacesHarness();

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

describe("after a primary clone moves", () => {
  const movedClonePaths = { ...clonePaths, utils: "packages/tools" };

  function moveUtilsClone(): void {
    renameSync(
      join(primaryRoot, "packages/utils"),
      join(primaryRoot, "packages/tools"),
    );
  }

  it("finds a workspace built before the move with its worktree at the clone's new folder", async () => {
    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "spans", extraRepos: ["utils"] },
    );
    writeFileSync(join(workspace.path, "packages/utils/README.md"), "edited");
    moveUtilsClone();

    const found = await workspaces({ clonePaths: movedClonePaths }).find({
      repo: "byro-repo",
      number: 7,
    });

    const tools = join(workspace.path, "packages/tools");
    expect(found?.branchedRepos).toEqual(["byro-repo", "utils"]);
    expect(found?.dirtyRepos).toEqual(["utils"]);
    expect(branchOf(tools)).toBe("issue-7-spans");
    expect(readFileSync(join(tools, "README.md"), "utf8")).toBe("edited");
    expect(existsSync(join(workspace.path, "packages/utils"))).toBe(false);
  });

  it("points a moved worktree's shared-file links at the moved clone", async () => {
    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "spans" },
    );
    renameSync(
      join(primaryRoot, "packages/framework"),
      join(primaryRoot, "packages/sheets"),
    );

    await workspaces({
      clonePaths: { ...clonePaths, "sheets-framework": "packages/sheets" },
    }).find({ repo: "byro-repo", number: 7 });

    expect(
      realpathSync(join(workspace.path, "packages/sheets/sheets.config.json")),
    ).toBe(join(primaryRoot, "packages/sheets/sheets.config.json"));
  });

  it("resumes a moved detached repo onto the moved primary's master", async () => {
    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "spans" },
    );
    moveUtilsClone();
    const newerUtils = advanceMaster("packages/tools", "newer.txt");

    await workspaces({ clonePaths: movedClonePaths }).start({
      repo: "byro-repo",
      number: 7,
    });

    const tools = join(workspace.path, "packages/tools");
    expect(branchOf(tools)).toBeUndefined();
    expect(git(tools, "rev-parse", "HEAD")).toBe(newerUtils);
  });

  it("refuses to resume when the moved detached repo is dirty, naming it", async () => {
    const workspace = await workspaces().create(
      { repo: "byro-repo", number: 7 },
      { slug: "spans" },
    );
    writeFileSync(join(workspace.path, "packages/utils/new.txt"), "untracked");
    moveUtilsClone();

    await expect(
      workspaces({ clonePaths: movedClonePaths }).start({
        repo: "byro-repo",
        number: 7,
      }),
    ).rejects.toThrow(/uncommitted changes in utils/);
  });

  it("builds a workspace made after the move at the clone's new folder", async () => {
    moveUtilsClone();

    const workspace = await workspaces({ clonePaths: movedClonePaths }).create(
      { repo: "byro-repo", number: 7 },
      { slug: "spans", extraRepos: ["utils"] },
    );

    expect(branchOf(join(workspace.path, "packages/tools"))).toBe(
      "issue-7-spans",
    );
    expect(existsSync(join(workspace.path, "packages/utils"))).toBe(false);
  });
});
