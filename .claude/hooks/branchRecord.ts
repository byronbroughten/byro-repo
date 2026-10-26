// SessionStart records each primary checkout's branch and HEAD for the session; SessionEnd marks the record ended. The branch guard reads them.
import { realpathSync } from "node:fs";

import { endedRecord, startedRecord } from "./lib/branchGuard.ts";
import {
  checkoutStatesOf,
  primaryCheckoutsOf,
  primaryRootOf,
  readRecord,
  writeRecord,
} from "./lib/branchRecords.ts";
import { projectDirOf, readHookInput, runFailOpen } from "./lib/hookIo.ts";

await runFailOpen(() => {
  const input = readHookInput();
  const sessionId = input?.session_id;
  if (!input || sessionId === undefined) return;
  const existing = readRecord(sessionId);
  if (input.hook_event_name === "SessionEnd") {
    if (existing) writeRecord(endedRecord(existing, Date.now()));
    return;
  }
  if (input.hook_event_name !== "SessionStart") return;
  const projectDir = projectDirOf(input);
  const primaryRoot = primaryRootOf(projectDir);
  // A session in an issue workspace works its own branches, so it holds no primary checkout's branch.
  if (
    primaryRoot === undefined ||
    realpathSync(projectDir) !== realpathSync(primaryRoot)
  ) {
    return;
  }
  const checkouts = checkoutStatesOf(primaryCheckoutsOf(primaryRoot));
  writeRecord(startedRecord(existing, sessionId, checkouts, Date.now()));
});
