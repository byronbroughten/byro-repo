// Decides what SessionStart adds for an interactive session in an issue workspace: the session recorded under that
// issue in its facts file, and after `/clear` a line saying where the session is. Pure; sessionIdContext.ts does the I/O.
import { basename, dirname } from "node:path";

import type { AddedSession } from "@byronbroughten/spec-runner/FactsFile";
import {
  isSameHolder,
  isSessionKey,
  issueLabelOf,
  type IssueRef,
  type LeasedWorkspace,
  type LeaseHolder,
} from "@byronbroughten/spec-runner/IssueWorkspaces";

import type { SessionMode } from "./tiers.ts";

export interface StartingSession {
  mode: SessionMode;
  sessionId: string;
  holder: LeaseHolder;
  leased: LeasedWorkspace[];
}

export interface RecordedSession {
  issue: IssueRef;
  step: AddedSession["step"];
}

export function recordedSessionOf({
  mode,
  sessionId,
  holder,
  leased,
}: StartingSession): RecordedSession | undefined {
  // A runner step's sessions are recorded by the run, from its step stream.
  if (mode === "runnerStep") return undefined;
  const issue = leasedIssueOf(leased, holder)?.key;
  if (issue === undefined) return undefined;
  return { issue, step: { agent: "implement", sessionId } };
}

export interface ClearedSession {
  // SessionStart's source: startup, resume, clear or compact.
  source?: string;
  cwd?: string;
  holder: LeaseHolder;
  leased: LeasedWorkspace[];
}

export function whereYouAreLineOf({
  source,
  cwd,
  holder,
  leased,
}: ClearedSession): string | undefined {
  if (source !== "clear" || cwd === undefined) return undefined;
  const workspace = leasedIssueOf(leased, holder);
  if (workspace === undefined || !isInside(cwd, workspace.path)) {
    return undefined;
  }
  const { repo, number } = workspace.key;
  return `You are in ${issueLabelOf(workspace.key)}'s workspace, leased to this session: \`/start-issue ${repo} ${number}\` continues it from its handoff, and work outside it needs \`ExitWorktree\` with \`keep\` first.`;
}

export function activeAccountOf(cswapStatus: string): number | undefined {
  try {
    const number = JSON.parse(cswapStatus)?.active?.number;
    return typeof number === "number" ? number : undefined;
  } catch {
    return undefined;
  }
}

// A transcript sits at <config folder>/projects/<project>/<session>.jsonl, as StepStream.ts reads a step's.
export function configFolderOf(
  transcriptPath: string | undefined,
): string | undefined {
  if (transcriptPath === undefined) return undefined;
  const projects = dirname(dirname(transcriptPath));
  if (basename(projects) !== "projects") return undefined;
  return dirname(projects);
}

function leasedIssueOf(
  leased: LeasedWorkspace[],
  holder: LeaseHolder,
): (LeasedWorkspace & { key: IssueRef }) | undefined {
  return leased.find(
    (workspace): workspace is LeasedWorkspace & { key: IssueRef } =>
      workspace.lease.isLive &&
      isSameHolder(workspace.lease, holder) &&
      !isSessionKey(workspace.key),
  );
}

function isInside(cwd: string, folder: string): boolean {
  return cwd === folder || cwd.startsWith(`${folder}/`);
}
