import { existsSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { FakeDocuments } from "./Docs/FakeDocuments.ts";
import { FakeIssueSource } from "./FakeIssueSource.ts";
import { git } from "./GitFixture.ts";
import type { ReadableIssue } from "./IssueReader.ts";
import type { IssueRef } from "./IssueWorkspaces.ts";
import {
  useIssueWorkspacesHarness,
  workspaces,
} from "./issueWorkspacesHarness.ts";
import { PiecePull } from "./PiecePull.ts";
import { humanLabel } from "./SpecRun/runState.ts";
import { pieceDrafts } from "./specRunHarness/pieceDrafts.ts";
import { codeWorkflowOf } from "./Workflow/code/codeWorkflow.ts";
import { pieceWorkflowOf } from "./Workflow/piece/pieceWorkflow.ts";

useIssueWorkspacesHarness();

const developer = "byronbroughten";
const spec: IssueRef = { repo: "byro-repo", number: 213 };
// Filed in another repo than its spec's, so the pull promotes the spec's repo first.
const ticket: IssueRef = { repo: "utils", number: 7 };
const deliverableBody = `## Deliverable\n\nhttps://docs.google.com/document/d/${pieceDrafts.deliverableId}/edit\n`;
const pulledDraft =
  "# Part one\n<!-- developer -->\n\n## The harbour\n<!-- developer -->\n\nGulls circled the quay.\n\n## The crossing\n<!-- developer -->\n\nThe ferry left late.\n";

let source: FakeIssueSource;

function readableOf(
  issue: IssueRef,
  change: Partial<ReadableIssue> = {},
): ReadableIssue {
  return {
    issue,
    title: `Issue ${issue.number}`,
    body: "",
    author: developer,
    bodyEditors: [],
    comments: [],
    hasUnreadComments: false,
    titleRenamer: undefined,
    isOpen: true,
    labels: [],
    parent: undefined,
    subIssues: [],
    assignees: [],
    blockedBy: [],
    ...change,
  };
}

function piecePull(): PiecePull {
  const documents = new FakeDocuments([
    pieceDrafts.documentOf([
      pieceDrafts.paragraphOf("Part one", "HEADING_1"),
      ...pieceDrafts.h2ContentOf({
        "The harbour": "Gulls circled the quay.",
        "The crossing": "The ferry left late.",
      }),
    ]),
  ]);
  return PiecePull.init({
    source,
    developer,
    workspaces: workspaces(),
    workflows: {
      code: codeWorkflowOf({ checks: [], reviewSkillName: "code-review" }),
      piece: pieceWorkflowOf({
        overlapCommand: ["true"],
        verifyQuotesCommand: ["true"],
        documents,
      }),
    },
  });
}

beforeEach(() => {
  source = FakeIssueSource.init();
  source.issues.set(
    spec.number,
    readableOf(spec, { body: deliverableBody, labels: ["piece"] }),
  );
  source.issues.set(ticket.number, readableOf(ticket, { parent: spec }));
});

describe("PiecePull", () => {
  it("commits the pulled Agent draft in the ticket's workspace, promoting the spec's repo, and prints the Deliverable ID and Section headings", async () => {
    const { path, branch } = await workspaces().create(ticket);

    const printed = await piecePull().pull(ticket);

    // The spec's repo is byro-repo, whose clone is the workspace's root.
    expect(git(path, "branch", "--show-current")).toBe(branch);
    expect(`${git(path, "show", `HEAD:${pieceDrafts.draftPath}`)}\n`).toBe(
      pulledDraft,
    );
    expect(git(path, "status", "--porcelain")).toBe("");
    expect(printed).toBe(
      [
        "piece:pull holds the Deliverable's Doc ID and each of its Section headings by heading path, as the Agent draft now holds them.",
        `Committed the Agent draft, ${pieceDrafts.draftPath}, on ${branch}.`,
        `Deliverable: ${pieceDrafts.deliverableId}`,
        "Sections by heading path:",
        "- Part one",
        "- Part one › The harbour",
        "- Part one › The crossing",
      ].join("\n"),
    );
  });

  it("commits nothing and says so when the Agent draft already matches the Doc", async () => {
    const { path, branch } = await workspaces().create(ticket);
    await piecePull().pull(ticket);
    const head = git(path, "rev-parse", "HEAD");

    const printed = await piecePull().pull(ticket);

    expect(git(path, "rev-parse", "HEAD")).toBe(head);
    expect(printed).toContain(
      `The Agent draft, ${pieceDrafts.draftPath}, already matches the Doc, so nothing was committed on ${branch}.`,
    );
  });

  describe("refuses with no write", () => {
    it("a ticket with no issue workspace", async () => {
      await expect(piecePull().pull(ticket)).rejects.toThrow(
        "utils #7 has no issue workspace; open one with `npm run issue:start -- utils 7` first.",
      );
    });

    it("a ticket that isn't a drafting ticket", async () => {
      source.issues.set(
        ticket.number,
        readableOf(ticket, { parent: spec, labels: ["research"] }),
      );
      const { path } = await workspaces().create(ticket);

      await expect(piecePull().pull(ticket)).rejects.toThrow(
        "utils #7 is not a drafting ticket: its Workflow has no pull Step, so piece:pull has nothing to pull.",
      );
      expect(existsSync(join(path, pieceDrafts.draftPath))).toBe(false);
    });

    it("an Edit gate ticket", async () => {
      source.issues.set(
        ticket.number,
        readableOf(ticket, { parent: spec, labels: [humanLabel] }),
      );
      const { path } = await workspaces().create(ticket);

      await expect(piecePull().pull(ticket)).rejects.toThrow(
        "utils #7 is not a drafting ticket",
      );
      expect(existsSync(join(path, pieceDrafts.draftPath))).toBe(false);
    });

    it("a code ticket", async () => {
      source.issues.set(
        spec.number,
        readableOf(spec, { body: deliverableBody, labels: ["code"] }),
      );
      await workspaces().create(ticket);

      await expect(piecePull().pull(ticket)).rejects.toThrow(
        "utils #7 is not a drafting ticket",
      );
    });

    it("a spec whose ## Deliverable names no Doc ID", async () => {
      source.issues.set(
        spec.number,
        readableOf(spec, {
          body: "## Deliverable\n\nTBD\n",
          labels: ["piece"],
        }),
      );
      const { path } = await workspaces().create(ticket);

      await expect(piecePull().pull(ticket)).rejects.toThrow(
        "byro-repo #213's ## Deliverable section names no Doc ID, so utils #7 has no Doc to pull.",
      );
      expect(git(path, "branch", "--show-current")).toBe("");
    });

    it("a spec whose body is Untrusted text", async () => {
      source.issues.set(
        spec.number,
        readableOf(spec, {
          body: deliverableBody,
          labels: ["piece"],
          author: "someone-else",
        }),
      );
      const { path } = await workspaces().create(ticket);

      await expect(piecePull().pull(ticket)).rejects.toThrow(
        "byro-repo #213's body is Untrusted text, written by someone-else, so piece:pull won't read its Deliverable.",
      );
      expect(existsSync(join(path, pieceDrafts.draftPath))).toBe(false);
    });
  });
});
