// The pull the runner's pull Step (../DraftPuller.ts) and `npm run piece:pull` (../../PiecePull.ts) share, once each has
// promoted the spec's repo onto the ticket's branch: the Agent draft its Workflow pulls from the Deliverable's Doc written, and committed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { type IssueRef, issueRef } from "../../IssueWorkspaces.ts";
import type { PulledDraft, PullRules } from "../../Workflow.ts";
import { draftCommits, type DraftFile } from "./draftCommits.ts";

export interface DraftPullInput {
  rules: PullRules;
  spec: IssueRef;
  documentId: string;
  // The spec's repo's clone in the ticket's workspace.
  clone: string;
}

export interface WrittenPull {
  pulled: PulledDraft;
  file: DraftFile;
}

export interface SpecTicketRefs {
  spec: IssueRef;
  ticket: IssueRef;
}

export const draftPull = {
  async written({
    rules,
    spec,
    documentId,
    clone,
  }: DraftPullInput): Promise<WrittenPull> {
    const draftPath = rules.draftPathOf(spec);
    const path = join(clone, draftPath);
    const pulled = await rules.pulledOf({
      documentId,
      draft: existsSync(path) ? readFileSync(path, "utf8") : undefined,
    });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, pulled.draft);
    return { pulled, file: { clone, draftPath } };
  },

  // A pull that changed nothing commits nothing; true when it committed.
  commit(file: DraftFile, { spec, ticket }: SpecTicketRefs): Promise<boolean> {
    return draftCommits.commit(
      file,
      `Pull the Deliverable into the Agent draft of ${issueRef.labelOf(spec)}, for #${ticket.number}`,
    );
  },

  noDeliverableOf({ spec, ticket }: SpecTicketRefs): string {
    return `${issueRef.labelOf(spec)}'s ## Deliverable section names no Doc ID, so ${issueRef.labelOf(ticket)} has no Doc to pull.`;
  },
};
