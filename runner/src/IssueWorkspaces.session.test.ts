import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { git } from "./GitFixture.ts";
import {
  branchOf,
  clonePaths,
  primaryRoot,
  primaryStates,
  registeredWorktrees,
  temp,
  titleLookups,
  useIssueWorkspacesHarness,
  workspaces,
} from "./issueWorkspacesHarness.ts";

useIssueWorkspacesHarness();

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
