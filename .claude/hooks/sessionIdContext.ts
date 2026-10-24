// SessionStart: puts the session's id in context; in an issue workspace this claude leases, records the session and says where it is; after /clear, names the run it supervises.
import { FactsFile } from "@byronbroughten/spec-runner/FactsFile";
import { IssueWorkspaces } from "@byronbroughten/spec-runner/IssueWorkspaces";
import { SupervisionRecords } from "@byronbroughten/spec-runner/SupervisionRecords";

import { nearestClaudeAncestor } from "../../scripts/runner/claudeAncestor.ts";
import { activeAccount } from "../../scripts/runner/cswapAccount.ts";
import {
  issueWorkspacesConfig,
  stateFolder,
} from "../../scripts/runner/runnerConfig.ts";
import {
  type HookInput,
  readHookInput,
  runFailOpen,
  writeHookOutput,
} from "./lib/hookIo.ts";
import {
  configFolderOf,
  type RecordedSession,
  recordedSessionOf,
  supervisingLineOf,
  whereYouAreLineOf,
} from "./lib/sessionRecord.ts";
import { sessionModeOf } from "./lib/tiers/tiers.ts";

await runFailOpen(async () => {
  const input = readHookInput();
  const sessionId = input?.session_id;
  if (input === undefined || sessionId === undefined) return;
  const lines = [
    `session: ${sessionId}`,
    ...(await leaseLinesOf(input, sessionId)),
    ...(await supervisionLinesOf(input)),
  ];
  writeHookOutput({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: lines.join("\n"),
    },
  });
});

// Its own fail-open, so a lease or facts-file failure still lets the session id through.
async function leaseLinesOf(
  input: HookInput,
  sessionId: string,
): Promise<string[]> {
  try {
    const holder = nearestClaudeAncestor();
    if (!holder) return [];
    const leased = await IssueWorkspaces.init(issueWorkspacesConfig).leases();
    const session = {
      ...input,
      mode: sessionModeOf(process.env),
      sessionId,
      holder,
      leased,
    };
    recordSession(input, recordedSessionOf(session));
    const line = whereYouAreLineOf(session);
    return line === undefined ? [] : [line];
  } catch {
    return [];
  }
}

// Its own fail-open too; only a clear start can yield the line, and a runner step is never a Supervisor.
async function supervisionLinesOf({ source }: HookInput): Promise<string[]> {
  try {
    if (source !== "clear" || sessionModeOf(process.env) === "runnerStep") {
      return [];
    }
    const holder = nearestClaudeAncestor();
    if (!holder) return [];
    const record = await SupervisionRecords.init(stateFolder).recordOf(holder);
    const line = supervisingLineOf({ source, record });
    return line === undefined ? [] : [line];
  } catch {
    return [];
  }
}

function recordSession(
  { transcript_path }: HookInput,
  recorded: RecordedSession | undefined,
): void {
  if (recorded === undefined) return;
  const account = activeAccount();
  const configFolder = configFolderOf(transcript_path);
  if (account === undefined || configFolder === undefined) return;
  const { issue, step } = recorded;
  FactsFile.init(stateFolder).addSession(issue, {
    ...step,
    account,
    configFolder,
  });
}
