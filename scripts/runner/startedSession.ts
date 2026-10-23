// Decides the implement session `issue:start` records when a Claude Code session leases an issue workspace mid-session, which SessionStart can't see.
import { join } from "node:path";

import type {
  IssueRef,
  WorkspaceKey,
} from "@byronbroughten/spec-runner/IssueWorkspaces";
import type { RecordedSession } from "@byronbroughten/spec-runner/transcriptFacts";

import { sessionModeOf } from "../../.claude/hooks/lib/tiers.ts";

interface StartedWorkspace {
  key: WorkspaceKey;
  env: NodeJS.ProcessEnv;
  account: number | undefined;
  homeFolder: string;
}

export interface StartedSession {
  issue: IssueRef;
  session: RecordedSession;
}

export function startedSessionOf({
  key,
  env,
  account,
  homeFolder,
}: StartedWorkspace): StartedSession | undefined {
  const sessionId = env.CLAUDE_CODE_SESSION_ID;
  if (sessionId === undefined || sessionModeOf(env) === "runnerStep") {
    return undefined;
  }
  if ("session" in key || account === undefined) return undefined;
  return {
    issue: key,
    session: {
      agent: "implement",
      sessionId,
      account,
      configFolder: env.CLAUDE_CONFIG_DIR ?? join(homeFolder, ".claude"),
    },
  };
}
