// Writes a ticket's outcome row file into a checkout from its facts file and transcripts. WrapUp.ts runs it with the
// merged workspace's own code, through scripts/runner/outcomeRow.ts, so a ticket that changes the row lands its own row
// in the new format; WrapUp.ts gathers what needs GitHub and commits the file. The format is outcomeLog.ts.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { FactsFile, type WrapUpFacts } from "./FactsFile.ts";
import type { IssueRef } from "./IssueWorkspaces.ts";
import {
  outcomeCommitMessage,
  type OutcomeFacts,
  outcomeFileOf,
  outcomePathOf,
} from "./outcomeLog.ts";
import { transcriptFactsOf } from "./transcriptFacts.ts";

export interface OutcomeRowRequest {
  issue: IssueRef;
  spec: IssueRef;
  githubOwner: string;
  filesChanged: number;
  handoffSessionIds: string[];
  stateFolder: string;
  // Relative to the checkout's root.
  outcomeFolder: string;
}

export interface WrittenOutcomeRow {
  // Relative to the checkout's root.
  path: string;
  commitMessage: string;
}

export function writeOutcomeRow(
  root: string,
  {
    stateFolder,
    outcomeFolder,
    handoffSessionIds,
    ...request
  }: OutcomeRowRequest,
): WrittenOutcomeRow {
  const facts = FactsFile.init(stateFolder).read(request.issue);
  const row = { ...request, facts: outcomeFactsOf(facts, handoffSessionIds) };
  const path = outcomePathOf(outcomeFolder, row);
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), outcomeFileOf(row));
  return { path, commitMessage: outcomeCommitMessage(row) };
}

function outcomeFactsOf(
  facts: WrapUpFacts,
  handoffSessionIds: string[],
): OutcomeFacts {
  const { sessions } = facts;
  if (sessions === undefined) return facts;
  return {
    ...facts,
    ...definedFactsOf(transcriptFactsOf(sessions, handoffSessionIds)),
  };
}

function definedFactsOf(facts: OutcomeFacts): OutcomeFacts {
  return Object.fromEntries(
    Object.entries(facts).filter(([, value]) => value !== undefined),
  ) as OutcomeFacts;
}
