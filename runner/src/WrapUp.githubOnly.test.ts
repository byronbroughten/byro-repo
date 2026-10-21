import { existsSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { git } from "./GitFixture.ts";
import {
  commitRed,
  failureOf,
  github,
  primaryOf,
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
  describe("a ticket that needed only GitHub writes", () => {
    const githubWrites = [
      {
        issue: "byronbroughten/byro-repo#213",
        action: "comment" as const,
        url: "https://github.com/byronbroughten/byro-repo/issues/213#issuecomment-1",
        summary: "Posted the addendum.",
      },
      {
        issue: "byronbroughten/byro-repo#246",
        action: "edit" as const,
        url: "https://github.com/byronbroughten/byro-repo/issues/246",
        summary: "Retitled it.",
      },
    ];

    function writeAppliedFacts(): void {
      writeFacts({
        closingComment: "Posted the addendum and retitled #246.",
        reviewFixes: "skipped",
        githubWrites,
      });
    }

    it("lands only the log row, skipping the merges and checks, and closes the issue with the write list", async () => {
      const workspace = await workspaceWith();
      commitRed(primaryRoot);
      writeAppliedFacts();

      const result = await wrapUp().run(ticket);

      expect(subjectsOf("byro-repo").slice(0, 2)).toEqual([
        "Record the #218 outcome: Opus medium, 0 files, 150K → 90K, review skipped (no code).",
        "Turn master red",
      ]);
      expect(git(remoteOf("byro-repo"), "rev-parse", "master")).toBe(
        git(primaryOf("byro-repo"), "rev-parse", "master"),
      );
      expect(result.completed).toEqual([
        "clean-check",
        "files-changed",
        "log-row",
        "fast-forward",
        "secret-scan",
        "push",
        "delete-branches",
        "remove-workspace",
        "close",
        "parent-check",
      ]);
      expect(existsSync(workspace.path)).toBe(false);
      expect(
        git(primaryOf("byro-repo"), "branch", "--list", "issue-218-*"),
      ).toBe("");
      expect(github.closed).toEqual([
        {
          issue: ticket,
          comment: [
            "Posted the addendum and retitled #246.",
            "",
            "GitHub writes:",
            "- comment on byronbroughten/byro-repo#213: Posted the addendum. https://github.com/byronbroughten/byro-repo/issues/213#issuecomment-1",
            "- edit of byronbroughten/byro-repo#246: Retitled it. https://github.com/byronbroughten/byro-repo/issues/246",
          ].join("\n"),
        },
      ]);
    });

    it("detaches and deletes the issue branch in every branched repo, removing the workspace", async () => {
      const workspace = await workspaceWith(["sheets-framework"]);
      writeAppliedFacts();

      const result = await wrapUp().run(ticket);

      expect(result.branchDeleteFailures).toEqual([]);
      expect(existsSync(workspace.path)).toBe(false);
      expect(
        git(primaryOf("sheets-framework"), "branch", "--list", "issue-218-*"),
      ).toBe("");
    });

    it("leaves another repo's issue branch with the same number alone", async () => {
      await workspaceWith();
      const framework = primaryOf("sheets-framework");
      git(framework, "branch", "issue-218-other-work");
      git(framework, "push", "origin", "issue-218-other-work");
      writeAppliedFacts();

      await wrapUp().run(ticket);

      expect(
        git(framework, "branch", "--list", "issue-218-other-work"),
      ).toContain("issue-218-other-work");
      expect(
        git(
          remoteOf("sheets-framework"),
          "branch",
          "--list",
          "issue-218-other-work",
        ),
      ).toContain("issue-218-other-work");
    });

    it("refuses uncommitted work in the workspace's root", async () => {
      const workspace = await workspaceWith();
      writeFileSync(join(workspace.path, "loose.ts"), "");
      writeAppliedFacts();

      expect(await failureOf(wrapUp().run(ticket))).toBe("dirty-tree");
    });

    it("resumes after a failed push and records the row once", async () => {
      await workspaceWith();
      writeAppliedFacts();
      const remote = remoteOf("byro-repo");
      renameSync(remote, `${remote}.gone`);

      expect(await failureOf(wrapUp().run(ticket))).toBe("network");
      const landed = git(primaryRoot, "rev-parse", "master");

      renameSync(`${remote}.gone`, remote);
      await wrapUp().run(ticket);

      expect(git(remote, "rev-parse", "master")).toBe(landed);
      expect(github.closed).toHaveLength(1);
    });
  });
});
