// PreToolUse on the gmail write tools: allows a call one signed-off /inbox Proposal covers, and asks for any other. Fails closed, unlike the other gates.
import { projectDirOf, readHookInput, writeHookOutput } from "./lib/hookIo.ts";
import { gmailGateDecisionAt } from "./lib/tiers/inboxData.ts";
import { sessionModeOf } from "./lib/tiers/tiers.ts";

const input = readHookInput();

if (input?.tool_name) {
  const decision = gmailGateDecisionAt(projectDirOf(input), {
    toolName: input.tool_name,
    input: { ...input.tool_input },
    mode: sessionModeOf(process.env),
  });
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
