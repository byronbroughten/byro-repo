// Decides SessionStart's facts-file record, "where you are" line for an issue workspace and supervising line; sessionIdContext.ts does the I/O.
import { basename, dirname } from "node:path";

import {
  isSessionKey,
  issueLabelOf,
  type IssueRef,
  type LeasedWorkspace,
  type LeaseHolder,
} from "@byronbroughten/spec-runner/IssueWorkspaces";
import type { SupervisionRecord } from "@byronbroughten/spec-runner/SupervisionRecords";
import type { StepSession } from "@byronbroughten/spec-runner/transcriptFacts";

import type { HookInput } from "./hookIo.ts";
import { leasedWorkspacesOf } from "./leaseRelease.ts";
import type { SessionMode } from "./tiers/tiers.ts";

export interface StartingSession {
  mode: SessionMode;
  sessionId: string;
  source?: HookInput["source"];
  cwd?: string;
  holder: LeaseHolder;
  leased: LeasedWorkspace[];
}

type LeasedIssueWorkspace = LeasedWorkspace & { key: IssueRef };

export interface RecordedSession {
  issue: IssueRef;
  step: StepSession;
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

export function whereYouAreLineOf({
  source,
  cwd,
  holder,
  leased,
}: StartingSession): string | undefined {
  if (source !== "clear" || cwd === undefined) return undefined;
  const workspace = leasedIssueOf(leased, holder);
  if (workspace === undefined || !isInside(cwd, workspace.path)) {
    return undefined;
  }
  const { repo, number } = workspace.key;
  return `You are in ${issueLabelOf(workspace.key)}'s workspace, leased to this session: \`/start-issue ${repo} ${number}\` continues it from its handoff, and work outside it needs \`ExitWorktree\` with \`keep\` first.`;
}

export interface SupervisingSession {
  source?: HookInput["source"];
  record: SupervisionRecord | undefined;
}

export function supervisingLineOf({
  source,
  record,
}: SupervisingSession): string | undefined {
  if (source !== "clear" || record === undefined) return undefined;
  const { owner, spec } = record;
  return `This session supervises ${issueLabelOf(spec)}'s run: \`/runner ${owner}/${spec.repo} ${spec.number}\` carries on from its last explained event, and \`/runner\` on another spec switches to that run.`;
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
): LeasedIssueWorkspace | undefined {
  return leasedWorkspacesOf(leased, holder).find(
    (workspace): workspace is LeasedIssueWorkspace =>
      !isSessionKey(workspace.key),
  );
}

function isInside(cwd: string, folder: string): boolean {
  return cwd === folder || cwd.startsWith(`${folder}/`);
}
