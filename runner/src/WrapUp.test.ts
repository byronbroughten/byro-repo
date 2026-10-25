import { cpSync, existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FactsFile } from "./FactsFile.ts";
import { git } from "./GitFixture.ts";
import { IssueWorkspaces } from "./IssueWorkspaces.ts";
import { writeOutcomeRow } from "./outcomeRowWriter.ts";
import type { RecordedSession, StepAgent } from "./transcriptFacts.ts";
import {
  clonePaths,
  commitIn,
  github,
  outcomePath,
  primaryOf,
  primaryRoot,
  remoteOf,
  subjectsOf,
  temp,
  ticket,
  useWrapUpHarness,
  workspacesConfig,
  workspaceWith,
  wrapUp,
  writeFacts,
  writeSavedFacts,
} from "./wrapUpHarness.ts";

useWrapUpHarness();

describe("run", () => {
  it("merges the branch, commits the log row and lands both on the pushed master", async () => {
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts();

    await wrapUp().run(ticket);

    expect(subjectsOf("byro-repo").slice(0, 3)).toEqual([
      "Record the #218 outcome: Opus medium, 1 files, 150K → 90K, first-try pass.",
      "Merge issue-218-wrap-up-script into master (#218)",
      "Add script.ts",
    ]);
    expect(git(remoteOf("byro-repo"), "rev-parse", "master")).toBe(
      git(primaryOf("byro-repo"), "rev-parse", "master"),
    );
    expect(existsSync(join(primaryRoot, "script.ts"))).toBe(true);
  });

  it("writes the outcome row in the spec's folder with every column", async () => {
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts({ reviewFixes: "fresh", whatReviewCaught: "A stale doc link" });

    await wrapUp().run(ticket);

    expect(readFileSync(join(primaryRoot, outcomePath), "utf8")).toBe(
      [
        "# byro-repo#218 outcome",
        "",
        "Spec: [byro-repo#213](https://github.com/byronbroughten/byro-repo/issues/213)",
        "",
        "| Issue | Pair | Account | Files changed | Peak context | Result | Proposals | Review rounds | Retries | Duration | Cost (API-equivalent) | Review cost | What review caught | Session ids |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        "| #218 | Opus medium | unrecorded | 1 | 150K → 90K | Fix (fresh resolver) | 0 | 1 | 0 | unrecorded | unrecorded | unrecorded | A stale doc link | unrecorded |",
        "",
      ].join("\n"),
    );
  });

  it("writes the row through the configured writer in the merged root checkout, where the ticket's own code is", async () => {
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts();
    const hasTicketCode: boolean[] = [];

    await wrapUp({
      writeOutcomeRow: async (root, request) => {
        hasTicketCode.push(existsSync(join(root, "script.ts")));
        return writeOutcomeRow(root, request);
      },
    }).run(ticket);

    expect(hasTicketCode).toEqual([true]);
    expect(readFileSync(join(primaryRoot, outcomePath), "utf8")).toContain(
      "| #218 | Opus medium |",
    );
  });

  it("counts a facts file's Defers, Proposals' old name, as Proposals", async () => {
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts({ reviewFixes: "none", ...{ defers: 2 } });

    await wrapUp().run(ticket);

    expect(readFileSync(join(primaryRoot, outcomePath), "utf8")).toContain(
      "| #218 | Opus medium | unrecorded | 1 | 150K → 90K | Pass | 2 |",
    );
  });

  it("computes the row's facts from the recorded sessions and the ticket's handoff comment", async () => {
    const configFolder = join(temp, "account-2");
    cpSync(
      join(import.meta.dirname, "..", "fixtures", "transcripts"),
      join(configFolder, "projects", "-workspace-byro-repo"),
      { recursive: true },
    );
    github.reply(ticket.number, "Picking this up.");
    github.reply(
      ticket.number,
      "## Handoff\n\nWork so far.\n\nsession: session-implement-1",
    );
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts({
      pair: undefined,
      peakContext: undefined,
      sessions: {
        steps: [
          recorded("implement", "session-implement-2", configFolder),
          recorded("review", "session-review", configFolder),
          recorded("resolve", "session-triage", configFolder),
          recorded("resolve", "session-fix", configFolder),
        ],
      },
    });

    await wrapUp().run(ticket);

    expect(
      readFileSync(join(primaryRoot, outcomePath), "utf8").split("\n")[6],
    ).toBe(
      "| #218 | Opus medium | 2 | 1 | 150K → 90K | Pass | 0 | 1 | 0 | 42 min | $1.45 | $0.11 | — | session-implement-1, session-implement-2, session-review, session-triage, session-fix |",
    );
  });

  it("reads and prices a facts file saved under the resolve step's old names", async () => {
    const configFolder = join(temp, "account-2");
    cpSync(
      join(import.meta.dirname, "..", "fixtures", "transcripts"),
      join(configFolder, "projects", "-workspace-byro-repo"),
      { recursive: true },
    );
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeSavedFacts({
      reviewFixes: "triage",
      whatReviewCaught: "A stale doc link",
      sessions: {
        account: 2,
        configFolder,
        steps: [
          { agent: "implement", sessionId: "session-implement-2" },
          { agent: "review", sessionId: "session-review" },
          { agent: "triage", sessionId: "session-triage" },
          { agent: "fix", sessionId: "session-fix" },
        ],
      },
    });

    await wrapUp().run(ticket);

    const row = readFileSync(join(primaryRoot, outcomePath), "utf8").split(
      "\n",
    )[6];
    expect(row).toContain("| Fix (fresh resolver) |");
    expect(row).toContain("| $0.11 | A stale doc link |");
  });

  it("computes an interactive ticket's row from its recorded sessions", async () => {
    const configFolder = join(temp, "account-2");
    cpSync(
      join(import.meta.dirname, "..", "fixtures", "transcripts"),
      join(configFolder, "projects", "-workspace-byro-repo"),
      { recursive: true },
    );
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    FactsFile.init(join(temp, "state"))
      .addSession(
        ticket,
        recorded("implement", "session-implement-1", configFolder),
      )
      .addSession(
        ticket,
        recorded("implement", "session-implement-2", configFolder),
      )
      .setReviewFacts(ticket, { reviewFixes: "none" })
      .setClosingFacts(ticket, { closingComment: "Landed the hook." });

    await wrapUp().run(ticket);

    expect(
      readFileSync(join(primaryRoot, outcomePath), "utf8").split("\n")[6],
    ).toBe(
      "| #218 | Opus medium | 2 | 1 | 150K → 90K | Pass | 0 | 1 | 0 | 30 min | $1.45 | unrecorded | — | session-implement-1, session-implement-2 |",
    );
  });

  it("prices an interactive review that started no further step as its review session", async () => {
    const configFolder = join(temp, "account-2");
    cpSync(
      join(import.meta.dirname, "..", "fixtures", "transcripts"),
      join(configFolder, "projects", "-workspace-byro-repo"),
      { recursive: true },
    );
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    FactsFile.init(join(temp, "state"))
      .addSession(
        ticket,
        recorded("implement", "session-implement-2", configFolder),
      )
      .addSession(ticket, recorded("review", "session-review", configFolder))
      .setReviewFacts(ticket, { reviewFixes: "none" })
      .setClosingFacts(ticket, { closingComment: "Landed the hook." });

    await wrapUp().run(ticket);

    expect(
      readFileSync(join(primaryRoot, outcomePath), "utf8").split("\n")[6],
    ).toContain("| $0.02 | — | session-implement-2, session-review |");
  });

  it("puts a ticketless spec's row in a folder of its own", async () => {
    github.parents.clear();
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts();

    await wrapUp().run(ticket);

    const ownFolder = "docs/agents/outcomes/byro-repo-218/byro-repo-218.md";
    expect(existsSync(join(primaryRoot, ownFolder))).toBe(true);
  });

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

  it("rebuilds the merge and reruns the checks when master moved during them", async () => {
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts();
    const movedOnce = join(temp, "moved");
    const moveMaster: [string, ...string[]] = [
      "node",
      "-e",
      `const fs = require("fs");
       if (!fs.existsSync(${JSON.stringify(movedOnce)})) {
         fs.writeFileSync(${JSON.stringify(movedOnce)}, "");
         require("child_process").execFileSync("git", ["commit", "--allow-empty", "-m", "Meanwhile on master"], { cwd: ${JSON.stringify(primaryRoot)} });
       }`,
    ];

    await wrapUp({ checks: [moveMaster] }).run(ticket);

    const firstParents = git(
      primaryRoot,
      "log",
      "--first-parent",
      "--format=%s",
    );
    expect(firstParents.split("\n")).toEqual([
      "Record the #218 outcome: Opus medium, 1 files, 150K → 90K, first-try pass.",
      "Merge issue-218-wrap-up-script into master (#218)",
      "Meanwhile on master",
      "Initial commit",
    ]);
  });
});

function recorded(
  agent: StepAgent,
  sessionId: string,
  configFolder: string,
): RecordedSession {
  return { agent, sessionId, account: 2, configFolder };
}
