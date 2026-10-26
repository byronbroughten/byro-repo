// The gmail gate's I/O: finds the /inbox data in the primary root's personal clone and reads it. The decisions are in gmailGate.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { primaryRootOf } from "../branchRecords.ts";
import {
  type GmailCall,
  gmailGateDecision,
  gmailWrites,
  unreadableDataDecision,
} from "./gmailGate.ts";
import type { Decision } from "./tiers.ts";

type GmailToolCall = Omit<GmailCall, "proposals" | "changes">;

export function gmailGateDecisionAt(
  projectDir: string,
  call: GmailToolCall,
): Decision | undefined {
  if (!gmailWrites.has(call.toolName)) return undefined;
  const inboxFolder = inboxFolderOf(projectDir);
  if (inboxFolder === undefined) return unreadableDataDecision(call.mode);
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

// The primary root's clone, not a workspace's, so every session reads one copy.
function inboxFolderOf(projectDir: string): string | undefined {
  const primaryRoot = primaryRootOf(projectDir);
  if (primaryRoot === undefined) return undefined;
  return join(primaryRoot, "packages", "personal", "inbox");
}
