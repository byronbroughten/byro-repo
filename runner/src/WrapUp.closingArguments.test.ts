import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { git } from "./GitFixture.ts";
import {
  commitIn,
  cutGitHubAfterTheRow,
  failureOf,
  github,
  outcomeFolder,
  outcomePath,
  primaryOf,
  primaryRoot,
  subjectsOf,
  ticket,
  useWrapUpHarness,
  workspaceWith,
  wrapUp,
} from "./wrapUpHarness.ts";

useWrapUpHarness();

describe("run", () => {
  describe("with closing facts passed as arguments", () => {
    it("lands a ticket no facts file was written for, closing it with the passed comment and undone boxes", async () => {
      const workspace = await workspaceWith();
      commitIn(workspace, "byro-repo", "script.ts", "export {};\n");

      await wrapUp().run(ticket, {
        closing: {
          closingComment: "Landed the wrap-up script.",
          boxesUndone: [{ box: "Docs match", reason: "Left for #219." }],
        },
      });

      expect(subjectsOf("byro-repo")[0]).toBe(
        "Merge issue-218-wrap-up-script into master (#218)",
      );
      expect(github.closed).toEqual([
        {
          issue: ticket,
          comment: [
            "Landed the wrap-up script.",
            "",
            "Left undone:",
            "- Docs match: Left for #219.",
          ].join("\n"),
        },
      ]);
    });

    it("fails naming --closing when neither the arguments nor a facts file give a closing comment", async () => {
      const workspace = await workspaceWith();
      commitIn(workspace, "byro-repo", "script.ts", "export {};\n");

      await expect(wrapUp().run(ticket)).rejects.toThrow("--closing");
      expect(github.closed).toEqual([]);
    });
  });

  describe("--no-code", () => {
    it("closes the issue and logs its row with no branches, no commit and no GitHub writes", async () => {
      const workspace = await workspaceWith();
      const masterBefore = git(primaryRoot, "rev-parse", "master");

      await wrapUp().run(ticket, {
        closing: { closingComment: "Edited the shared doc." },
        hasNoCode: true,
      });

      expect(existsSync(join(outcomeFolder, outcomePath))).toBe(true);
      expect(git(primaryRoot, "rev-parse", "master")).toBe(masterBefore);
      expect(existsSync(workspace.path)).toBe(false);
      expect(
        git(primaryOf("byro-repo"), "branch", "--list", "issue-218-*"),
      ).toBe("");
      expect(github.closed).toEqual([
        { issue: ticket, comment: "Edited the shared doc." },
      ]);
    });

    it("resumes past its fast-forward on a rerun with no arguments", async () => {
      await workspaceWith();

      expect(
        await failureOf(
          wrapUp(cutGitHubAfterTheRow()).run(ticket, {
            closing: { closingComment: "Edited the shared doc." },
            hasNoCode: true,
          }),
        ),
      ).toBe("network");
      github.failuresLeft = 0;
      await wrapUp().run(ticket);

      expect(github.closed).toEqual([
        { issue: ticket, comment: "Edited the shared doc." },
      ]);
    });

    it("is what a ticket with no branch ahead and no GitHub writes is told to pass", async () => {
      await workspaceWith();

      await expect(
        wrapUp().run(ticket, {
          closing: { closingComment: "Edited the shared doc." },
        }),
      ).rejects.toThrow("--no-code");
      expect(github.closed).toEqual([]);
    });
  });
});
