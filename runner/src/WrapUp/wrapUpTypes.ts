// The config, port and parent types WrapUp and its collaborators share, and the GitHub labels wrap-up acts on.

import type { IssueRef, IssueWorkspacesConfig } from "../IssueWorkspaces.ts";
import type {
  OutcomeRowRequest,
  WrittenOutcomeRow,
} from "../outcomeRowWriter.ts";
import type { IssueComment } from "../SpecRun.ts";

export const labels = {
  map: "wayfinder:map",
  human: "ready-for-human",
} as const;

export interface ParentIssue {
  issue: IssueRef;
  labels: string[];
  // Undefined when GitHub's response carried no readable sub-issue summary.
  subIssues: { total: number; completed: number } | undefined;
}

export interface WrapUpGitHub {
  closeIssue(issue: IssueRef, comment: string): Promise<void>;
  parentOf(issue: IssueRef): Promise<ParentIssue | undefined>;
  subIssuesOf(issue: IssueRef): Promise<IssueRef[]>;
  labelsOf(issue: IssueRef): Promise<string[]>;
  commentsOf(issue: IssueRef): Promise<string[]>;
  authoredCommentsOf(issue: IssueRef): Promise<IssueComment[]>;
}

export type ParentCheck =
  | { kind: "none" }
  | { kind: "map"; parent: IssueRef }
  | { kind: "open-sub-issues"; parent: IssueRef }
  | { kind: "ready-to-close"; parent: IssueRef };

export interface WrapUpKnobs {
  networkTries: number;
  // The wait after the first failed try, doubled after each later one.
  backoffMs: number;
  lockPollMs: number;
}

export const defaultWrapUpKnobs: WrapUpKnobs = {
  networkTries: 3,
  backoffMs: 2000,
  lockPollMs: 5000,
};

export interface WrapUpConfig {
  workspaces: IssueWorkspacesConfig;
  github: WrapUpGitHub;
  githubOwner: string;
  // The one login whose review lists the close step counts.
  developer: string;
  // Each a command and its args, run from the workspace's root after the merges.
  checks: [string, ...string[]][];
  // Relative to the root repo.
  outcomeFolder: string;
  // Holds each ticket's facts and progress files; gitignored.
  stateFolder: string;
  // Writes the row file into the merged root checkout with that checkout's code; unset, with the code already loaded.
  writeOutcomeRow?(
    root: string,
    request: OutcomeRowRequest,
  ): Promise<WrittenOutcomeRow>;
  // Run at the primary root once the primaries are fast-forwarded; a failure only warns.
  afterFastForward?(primaryRoot: string): Promise<void>;
  knobs?: Partial<WrapUpKnobs>;
  sleep?(ms: number): Promise<void>;
  log?(line: string): void;
}
