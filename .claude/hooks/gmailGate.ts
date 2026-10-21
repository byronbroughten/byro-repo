// PreToolUse on the gmail write tools: allows a call one signed-off /inbox Proposal covers, and asks for any other. Fails closed, unlike the other gates.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  gmailGateDecision,
  gmailWrites,
  unreadableDataDecision,
} from "./lib/gmailGate.ts";
import { readHookInput, writeHookOutput } from "./lib/hookIo.ts";
import { type Decision, sessionModeOf } from "./lib/tiers.ts";

const inboxData = join(homedir(), ".claude", "inbox-data");
const input = readHookInput();
const mode = sessionModeOf(process.env);

if (input?.tool_name && gmailWrites.has(input.tool_name)) {
  let decision: Decision | undefined;
  try {
    decision = gmailGateDecision({
      toolName: input.tool_name,
      input: { ...input.tool_input },
      proposals: readFileSync(join(inboxData, "proposals.md"), "utf8"),
      changes: readFileSync(join(inboxData, "changes.md"), "utf8"),
      mode,
    });
  } catch {
    decision = unreadableDataDecision(mode);
  }
  if (decision) {
    writeHookOutput({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision.permissionDecision,
        permissionDecisionReason: decision.reason,
      },
    });
  }
}
