import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { git } from "./GitFixture.ts";
import {
  commitIn,
  primaryOf,
  primaryRoot,
  remoteOf,
  ticket,
  useWrapUpHarness,
  workspaceWith,
  wrapUp,
  writeFacts,
} from "./wrapUpHarness.ts";

useWrapUpHarness();

describe("afterFastForward", () => {
  it("runs at the primary root once the primaries hold the landed work", async () => {
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts();
    const calls: { root: string; hasLandedWork: boolean }[] = [];

    await wrapUp({
      async afterFastForward(root) {
        calls.push({
          root,
          hasLandedWork: existsSync(join(root, "script.ts")),
        });
      },
    }).run(ticket);

    expect(calls).toEqual([{ root: primaryRoot, hasLandedWork: true }]);
  });

  it("warns on a failure and still finishes the wrap-up", async () => {
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts();
    const lines: string[] = [];

    await wrapUp({
      async afterFastForward() {
        throw new Error("prepare exited 1");
      },
      log: (line) => lines.push(line),
    }).run(ticket);

    expect(lines).toContain(
      "Warning: the after-fast-forward hook failed, continuing: prepare exited 1",
    );
    expect(git(remoteOf("byro-repo"), "rev-parse", "master")).toBe(
      git(primaryOf("byro-repo"), "rev-parse", "master"),
    );
    expect(existsSync(workspace.path)).toBe(false);
  });
});
