// The gmail gate's I/O: reads the /inbox data in the session's own personal clone. The decisions are in gmailGate.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type GmailCall,
  gmailGateDecision,
  gmailWrites,
  unreadableDataDecision,
} from "./gmailGate.ts";
import type { Decision } from "./tiers.ts";

type GmailToolCall = Omit<GmailCall, "proposals" | "changes">;

// The session's own checkout, the copy its /inbox edits land in through wrap-up.
export function gmailGateDecisionAt(
  projectDir: string,
  call: GmailToolCall,
): Decision | undefined {
  if (!gmailWrites.has(call.toolName)) return undefined;
  const inboxFolder = join(projectDir, "packages", "personal", "inbox");
  try {
    return gmailGateDecision({
      ...call,
      proposals: readFileSync(join(inboxFolder, "proposals.md"), "utf8"),
      changes: readFileSync(join(inboxFolder, "changes.md"), "utf8"),
    });
  } catch {
    return unreadableDataDecision(call.mode);
  }
}
