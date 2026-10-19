import {
  chmodSync,
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  installs,
  primaryRoot,
  useIssueWorkspacesHarness,
  workspaces,
  writeHiddenLockfile,
  writeLockfile,
} from "./issueWorkspacesHarness.ts";

useIssueWorkspacesHarness();

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
