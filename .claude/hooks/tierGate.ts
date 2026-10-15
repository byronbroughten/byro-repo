// PreToolUse on Bash applies the tier gate; PostToolUse on Bash records each app chore dry run that ran, for a later --send.
import { readFileSync, writeFileSync } from "node:fs";

import {
  readHookInput,
  runFailOpen,
  sessionStatePath,
  writeHookOutput,
} from "./lib/hookIo.ts";
import { dryRunChoresOf, gateDecision } from "./lib/tiers.ts";

const dryRunSuffix = "chore-dry-runs.json";

await runFailOpen(() => {
  const input = readHookInput();
  if (!input || input.tool_name !== "Bash") return;
  const command = input.tool_input?.command;
  if (typeof command !== "string") return;
  const dryRunsPath = sessionStatePath(input.session_id, dryRunSuffix);
  if (input.hook_event_name === "PostToolUse") {
    recordDryRuns(dryRunsPath, dryRunChoresOf(command));
    return;
  }
  const decision = gateDecision({
    command,
    mode: "interactive",
    dryRuns: readDryRuns(dryRunsPath),
  });
  if (!decision) return;
  writeHookOutput({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision.permissionDecision,
      permissionDecisionReason: decision.reason,
    },
  });
});

function recordDryRuns(path: string, chores: string[]): void {
  if (chores.length === 0) return;
  const recorded = new Set([...readDryRuns(path), ...chores]);
  writeFileSync(path, JSON.stringify([...recorded]));
}

function readDryRuns(path: string): string[] {
  try {
    const recorded = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(recorded) ? recorded : [];
  } catch {
    return [];
  }
}
