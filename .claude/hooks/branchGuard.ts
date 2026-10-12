// PreToolUse on Bash: denies a branch move or commit in a primary checkout that would pull a branch or HEAD out from under another session.
import { existsSync } from "node:fs";

import { branchDecision, type GuardMode, headMovingCheckouts, refreshedRecord } from "./lib/branchGuard.ts";
import { checkoutStatesOf, primaryCheckoutsOf, primaryRootOf, readAllRecords, readRecord, writeRecord } from "./lib/branchRecords.ts";
import { readHookInput, runFailOpen, writeDenyOutput } from "./lib/hookIo.ts";

// #225 flips this to "strict" once the runner works every ticket in an issue workspace.
const mode: GuardMode = "interim";

await runFailOpen(() => {
  const input = readHookInput();
  const command = input?.tool_input?.command;
  const sessionId = input?.session_id;
  if (input?.tool_name !== "Bash" || typeof command !== "string" || sessionId === undefined) return;
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
  const cwd = input.cwd ?? projectDir;
  const primaryRoot = primaryRootOf(projectDir);
  if (primaryRoot === undefined) return;
  const primaryCheckouts = primaryCheckoutsOf(primaryRoot);
  const touched = headMovingCheckouts({ command, cwd, primaryCheckouts });
  let ownRecord = readRecord(sessionId);
  const pending = ownRecord?.refreshPending ?? [];
  if (touched.length === 0 && pending.length === 0) return;

  const now = Date.now();
  const currentCheckouts = checkoutStatesOf([...new Set([...touched, ...pending])]);
  if (ownRecord && pending.length > 0) ownRecord = refreshedRecord(ownRecord, currentCheckouts, now);
  const decision = branchDecision({
    command,
    cwd,
    mode,
    primaryCheckouts,
    ownCheckouts: ownRecord?.checkouts ?? {},
    otherSessions: readAllRecords().filter((record) => record.sessionId !== sessionId),
    currentCheckouts,
    now,
    isExistingPath: existsSync,
  });
  if (decision.permissionDecision === "deny") {
    if (ownRecord) writeRecord(ownRecord);
    writeDenyOutput(decision.reason);
    return;
  }
  if (ownRecord) writeRecord({ ...ownRecord, refreshPending: touched });
});
