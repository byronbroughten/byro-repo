// The config, port, parent and landing types WrapUp and its collaborators share, and the GitHub labels wrap-up acts on.

import type {
  IssueRef,
  IssueWorkspacesConfig,
  Workspace,
  WorkspaceKey,
} from "../IssueWorkspaces.ts";
import type {
  OutcomeRowRequest,
  WrittenOutcomeRow,
} from "../outcomeRowWriter.ts";
import type { IssueComment } from "../SpecRun.ts";

export const labels = {
  map: "wayfinder:map",
  human: "ready-for-human",
} as const;

export const installCommandLabel = "npm install --ignore-scripts";

// A repo and the two commits whose package.json dependencies are compared.
export interface DependencyComparison {
  clone: string;
  from: string;
  to: string;
}

export type WrapUpStep =
  | "clean-check"
  | "files-changed"
  | "merges"
  | "checks"
  | "log-row"
  | "fast-forward"
  | "secret-scan"
  | "push"
  | "delete-branches"
  | "remove-workspace"
  | "level-workspace"
  | "close"
  | "parent-check";

export interface LandingBranch {
  repo: string;
  branch: string;
}

export interface BuiltRepo {
  // The primary's master the build started from, and the commit master fast-forwards to.
  base: string;
  head: string;
}

export interface Progress {
  completed: WrapUpStep[];
  filesChanged?: number;
  // Repo name to its build, in landing order with the root repo last.
  built?: Record<string, BuiltRepo>;
  // A ticket's derived branches, kept so a rerun past the fast-forward, when none is ahead any more, deletes them.
  branches?: LandingBranch[];
  branchDeleteFailures?: string[];
  isLeftOpen?: boolean;
  parent?: ParentCheck;
}

export interface Landing {
  key: WorkspaceKey;
  // In landing order: the repos whose branch was ahead of master.
  branches: LandingBranch[];
  progress: Progress;
  kind: LandingKind;
}

// What differs between a ticket that lands branches, one with no code and a session, chosen once up front.
export interface LandingKind {
  // Leaves each landed repo's worktree on the commit its master fast-forwards to.
  build(landing: Landing, workspace: Workspace): Promise<void>;
  cleanRepos(landing: Landing): string[];
  branchesToDelete(landing: Landing): Promise<LandingBranch[]>;
  mergeArgs(branch: string): string[];
}

// Read before any switch and only for repos left unswitched, so a switch never leaves a stale answer.
export type UnswitchedDirtiness = Record<string, boolean>;

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
  // Run at a root whose merge changed a package.json's dependencies, as installCommandLabel words it.
  installDependencies?(root: string): Promise<void>;
  knobs?: Partial<WrapUpKnobs>;
  sleep?(ms: number): Promise<void>;
  log?(line: string): void;
}
