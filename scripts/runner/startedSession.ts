// Decides the implement session `issue:start` records when a Claude Code session leases an issue workspace mid-session, which SessionStart can't see.
import type {
  IssueRef,
  WorkspaceKey,
} from "@byronbroughten/spec-runner/IssueWorkspaces";
import {
  configFolderOf,
  type RecordedSession,
} from "@byronbroughten/spec-runner/transcriptFacts";

import { sessionModeOf } from "../../.claude/hooks/lib/tiers/tiers.ts";

interface StartedWorkspace {
  key: WorkspaceKey;
  env: NodeJS.ProcessEnv;
  account: number | undefined;
  homeFolder: string;
  // Set when the leasing claude process holds a supervision record.
  isSupervisor: boolean;
}

export interface StartedSession {
  issue: IssueRef;
  session: RecordedSession;
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
