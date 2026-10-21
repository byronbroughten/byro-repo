// SessionStart: puts the session's id in context, for a handoff's `session: <id>` line and the wrap-up facts.
// In an issue workspace this claude leases, it also records the session in that issue's facts file and, after `/clear`, says where the session is.
import { execFileSync } from "node:child_process";

import { FactsFile } from "@byronbroughten/spec-runner/FactsFile";
import { IssueWorkspaces } from "@byronbroughten/spec-runner/IssueWorkspaces";

import { nearestClaudeAncestor } from "../../scripts/runner/claudeAncestor.ts";
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
  activeAccountOf,
  configFolderOf,
  type RecordedSession,
  recordedSessionOf,
  whereYouAreLineOf,
} from "./lib/sessionRecord.ts";
import { sessionModeOf } from "./lib/tiers.ts";

await runFailOpen(async () => {
  const input = readHookInput();
  const sessionId = input?.session_id;
  if (input === undefined || sessionId === undefined) return;
  const lines = [
    `session: ${sessionId}`,
    ...(await leaseLinesOf(input, sessionId)),
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
    const mode = sessionModeOf(process.env);
    recordSession(
      input,
      recordedSessionOf({ mode, sessionId, holder, leased }),
    );
    const line = whereYouAreLineOf({ ...input, holder, leased });
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
  const account = activeAccountOf(cswapStatus());
  const configFolder = configFolderOf(transcript_path);
  if (account === undefined || configFolder === undefined) return;
  const { issue, step } = recorded;
  FactsFile.init(stateFolder).addSession(issue, {
    account,
    configFolder,
    step,
  });
}

// Empty when cswap is missing or fails, which leaves the account unknown.
function cswapStatus(): string {
  try {
    return execFileSync("cswap", ["status", "--json"], { encoding: "utf8" });
  } catch {
    return "";
  }
}
