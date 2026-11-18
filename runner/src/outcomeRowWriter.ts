// Writes a ticket's outcome row file to the outcome folder from its facts file and transcripts. WrapUp/LogRowWriter.ts runs
// it with the merged workspace's own code, through scripts/runner/outcomeRow.ts, so a ticket that changes the row lands
// its own row in the new format; it also gathers what needs GitHub. The format is outcomeLog.ts.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { FactsFile, type WrapUpFacts } from "./FactsFile.ts";
import type { IssueRef } from "./IssueWorkspaces.ts";
import {
  olderRowWorkflow,
  outcomeCommitMessage,
  type OutcomeFacts,
  outcomeFileOf,
  outcomePathOf,
} from "./outcomeLog.ts";
import {
  transcriptFactsOf,
  type TranscriptFactsRequest,
} from "./transcriptFacts.ts";
import type { WorkflowName } from "./Workflow.ts";

export interface OutcomeRowRequest {
  issue: IssueRef;
  spec: IssueRef;
  githubOwner: string;
  // Absent from a wrap-up older than the Workflow column, as this writer runs from the ticket's merged code.
  workflow?: WorkflowName;
  filesChanged: number;
  // The ticket's Model fit estimate; absent from a ticket without one, and from a wrap-up older than the Estimate column.
  estimate?: string;
  handoffSessionIds: string[];
  silenceTimeoutMs: number;
  stateFolder: string;
  // Absolute; a relative one, from a wrap-up older than the uncommitted row, is under the checkout's root.
  outcomeFolder: string;
}

export interface WrittenOutcomeRow {
  // Absolute.
  path: string;
  // Read only by a wrap-up older than the uncommitted row, which commits the row it lands with.
  commitMessage: string;
}

export function writeOutcomeRow(
  root: string,
  {
    stateFolder,
    outcomeFolder,
    handoffSessionIds,
    silenceTimeoutMs,
    workflow = olderRowWorkflow,
    estimate,
    ...request
  }: OutcomeRowRequest,
): WrittenOutcomeRow {
  const facts = FactsFile.init(stateFolder).read(request.issue);
  const row = {
    ...request,
    workflow,
    landedAt: new Date(),
    facts: {
      ...outcomeFactsOf(facts, { handoffSessionIds, silenceTimeoutMs }),
      estimate,
    },
  };
  const path = resolve(root, outcomePathOf(outcomeFolder, row));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, outcomeFileOf(row));
  return { path, commitMessage: outcomeCommitMessage(row) };
}

function outcomeFactsOf(
  facts: WrapUpFacts,
  request: TranscriptFactsRequest,
): OutcomeFacts {
  const { sessions } = facts;
  if (sessions === undefined) return facts;
  return {
    ...facts,
    ...definedFactsOf(transcriptFactsOf(sessions, request)),
  };
}

function definedFactsOf(facts: OutcomeFacts): OutcomeFacts {
  return Object.fromEntries(
    Object.entries(facts).filter(([, value]) => value !== undefined),
  ) as OutcomeFacts;
}
