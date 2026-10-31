// Decides and records the implement session for a Claude Code session that leases an issue workspace mid-session, which SessionStart can't see.
import { FactsFile } from "@byronbroughten/spec-runner/FactsFile";
import type {
  IssueRef,
  LeaseHolder,
  WorkspaceKey,
} from "@byronbroughten/spec-runner/IssueWorkspaces";
import { SupervisionRecords } from "@byronbroughten/spec-runner/SupervisionRecords";
import {
  configFolderOf,
  type RecordedSession,
} from "@byronbroughten/spec-runner/transcriptFacts";

import { sessionModeOf } from "../../.claude/hooks/lib/tiers/tiers.ts";

interface LeasingSession {
  key: WorkspaceKey;
  env: NodeJS.ProcessEnv;
  account: number | undefined;
  homeFolder: string;
}

interface StartedWorkspace extends LeasingSession {
  // Set when the leasing claude process holds a supervision record that hasn't ended.
  isSupervisor: boolean;
}

interface SessionToRecord extends LeasingSession {
  holder: LeaseHolder;
  stateFolder: string;
}

export interface StartedSession {
  issue: IssueRef;
  session: RecordedSession;
}

// SessionStart records a session that starts in the workspace; this records one that moves in later.
export async function recordStartedSession({
  holder,
  stateFolder,
  ...leasing
}: SessionToRecord): Promise<void> {
  const supervision =
    await SupervisionRecords.init(stateFolder).recordOf(holder);
  const started = startedSessionOf({
    ...leasing,
    isSupervisor: supervision !== undefined,
  });
  if (started === undefined) return;
  FactsFile.init(stateFolder).addSession(started.issue, started.session);
}

// A Supervisor's session watches a whole run, so recording it would list it as one ticket's implementer.
export function startedSessionOf({
  key,
  env,
  account,
  homeFolder,
  isSupervisor,
}: StartedWorkspace): StartedSession | undefined {
  const sessionId = env.CLAUDE_CODE_SESSION_ID;
  if (sessionId === undefined || sessionModeOf(env) === "runnerStep") {
    return undefined;
  }
  if ("session" in key || account === undefined || isSupervisor) {
    return undefined;
  }
  return {
    issue: key,
    session: {
      agent: "implement",
      sessionId,
      account,
      configFolder: configFolderOf(env, homeFolder),
    },
  };
}
