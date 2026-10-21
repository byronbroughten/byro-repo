import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { git } from "./GitFixture.ts";
import { WrapUpFailure } from "./WrapUpFailure.ts";
import {
  commitIn,
  failureOf,
  primaryRoot,
  remoteOf,
  subjectsOf,
  ticket,
  useWrapUpHarness,
  workspaceWith,
  wrapUp,
  writeFacts,
} from "./wrapUpHarness.ts";

useWrapUpHarness();

describe("run", () => {
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
      writeFacts();

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
