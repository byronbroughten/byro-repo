import { cpSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FactsFile } from "./FactsFile.ts";
import { git } from "./GitFixture.ts";
import { writeOutcomeRow } from "./outcomeRowWriter.ts";
import type { RecordedSession, StepAgent } from "./transcriptFacts.ts";
import {
  commitIn,
  github,
  outcomePath,
  primaryOf,
  primaryRoot,
  remoteOf,
  rootCloneOnly,
  subjectsOf,
  temp,
  ticket,
  useWrapUpHarness,
  workspaceWith,
  wrapUp,
  writeFacts,
  writeSavedFacts,
} from "./wrapUpHarness.ts";

useWrapUpHarness(rootCloneOnly);

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
        "| Issue | Workflow | Pair | Account | Files changed | Peak context | Result | Proposals | Review rounds | Retries | Limit resumes | Duration | Cost (API-equivalent) | Review cost | What review caught | Session ids |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        "| #218 | code | Opus medium | unrecorded | 1 | 150K → 90K | Fix (fresh resolver) | 0 | 1 | 0 | 0 | unrecorded | unrecorded | unrecorded | A stale doc link | unrecorded |",
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
      "| #218 | code | Opus medium |",
    );
  });

  it("counts a facts file's Defers, Proposals' old name, as Proposals", async () => {
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts({ reviewFixes: "none", ...{ defers: 2 } });

    await wrapUp().run(ticket);

    expect(readFileSync(join(primaryRoot, outcomePath), "utf8")).toContain(
      "| #218 | code | Opus medium | unrecorded | 1 | 150K → 90K | Pass | 2 |",
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
      "| #218 | code | Opus medium | 2 | 1 | 150K → 90K | Pass | 0 | 1 | 0 | 0 | 27 min | $1.45 | $0.11 | — | session-implement-1, session-implement-2, session-review, session-triage, session-fix |",
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
      "| #218 | code | Opus medium | 2 | 1 | 150K → 90K | Pass | 0 | 1 | 0 | 0 | 15 min | $1.45 | unrecorded | — | session-implement-1, session-implement-2 |",
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

  // No agent session ran, so its row would be nearly all unrecorded and only add noise to /mine-outcomes.
  it("lands a ready-for-human ticket with no outcome row", async () => {
    github.issues.set(ticket.number, {
      issue: ticket,
      title: "Wrap-up script",
      body: "",
      isOpen: true,
      labels: ["ready-for-human"],
      url: "",
      author: "byronbroughten",
      bodyEditors: [],
    });
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts();

    await wrapUp().run(ticket);

    expect(subjectsOf("byro-repo").slice(0, 2)).toEqual([
      "Merge issue-218-wrap-up-script into master (#218)",
      "Add script.ts",
    ]);
    expect(existsSync(join(primaryRoot, outcomePath))).toBe(false);
    expect(github.closed.map(({ issue }) => issue)).toEqual([ticket]);
  });

  it("rebuilds the merge and reruns the checks when master moved during them", async () => {
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts();
    const movedOnce = join(temp, "moved");
    const moveMaster: [string, ...string[]] = [
      "sh",
      "-c",
      'test -f "$1" || { : > "$1"; git -C "$2" commit -q --allow-empty -m "Meanwhile on master"; }',
      "sh",
      movedOnce,
      primaryRoot,
    ];

    await wrapUp({ mergeChecks: [moveMaster] }).run(ticket);

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
