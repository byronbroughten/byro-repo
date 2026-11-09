import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { git } from "./GitFixture.ts";
import { IssueWorkspaces } from "./IssueWorkspaces.ts";
import {
  clonePaths,
  commitIn,
  primaryOf,
  primaryRoot,
  remoteOf,
  subjectsOf,
  ticket,
  useWrapUpHarness,
  workspacesConfig,
  workspaceWith,
  wrapUp,
  writeFacts,
} from "./wrapUpHarness.ts";

useWrapUpHarness();

describe("run", () => {
  it("derives each repo's branch ahead of master and lands them in landing order, the clone before the root", async () => {
    const workspace = await workspaceWith(["sheets-framework"]);
    commitIn(workspace, "sheets-framework", "core.ts", "export {};\n");
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts();

    const result = await wrapUp().run(ticket);

    expect(result.filesChanged).toBe(2);
    expect(subjectsOf("sheets-framework").slice(0, 2)).toEqual([
      "Merge issue-218-wrap-up-script into master (#218)",
      "Add core.ts",
    ]);
    expect(subjectsOf("byro-repo").slice(1, 3)).toEqual([
      "Merge issue-218-wrap-up-script into master (#218)",
      "Add script.ts",
    ]);
    expect(git(remoteOf("sheets-framework"), "rev-parse", "master")).toBe(
      git(primaryOf("sheets-framework"), "rev-parse", "master"),
    );
  });

  it("lands a workspace built before its clone's primary moved folders", async () => {
    const workspace = await workspaceWith(["sheets-framework"]);
    commitIn(workspace, "sheets-framework", "core.ts", "export {};\n");
    writeFacts();
    const movedPrimary = join(primaryRoot, "packages/sheets");
    renameSync(primaryOf("sheets-framework"), movedPrimary);

    await wrapUp({
      workspaces: {
        ...workspacesConfig(),
        clonePaths: { ...clonePaths, "sheets-framework": "packages/sheets" },
      },
    }).run(ticket);

    expect(git(movedPrimary, "log", "-2", "--format=%s", "master")).toBe(
      "Merge issue-218-wrap-up-script into master (#218)\nAdd core.ts",
    );
    expect(existsSync(join(movedPrimary, "core.ts"))).toBe(true);
    expect(existsSync(workspace.path)).toBe(false);
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
    writeFacts();

    await wrapUp().run(ticket);

    expect(subjectsOf("byro-repo")[0]).toBe(
      "Record the #218 outcome: Opus medium, 1 files, 150K → 90K, first-try pass.",
    );
    expect(git(remoteOf("byro-repo"), "rev-parse", "master")).toBe(
      git(primaryOf("byro-repo"), "rev-parse", "master"),
    );
  });
});
