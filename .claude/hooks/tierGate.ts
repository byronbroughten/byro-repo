// PreToolUse on Bash and the gworkspace write and create tools applies the tier gate; PostToolUse on Bash records each app chore dry run that ran, for a later --send.
import { writeFileSync } from "node:fs";

import { driveOwnersOf } from "./lib/driveOwners.ts";
import {
  cachedOwnerLookup,
  driveGateDecision,
  type OwnerCache,
} from "./lib/driveTiers.ts";
import {
  type HookInput,
  readHookInput,
  readJsonFile,
  runFailOpen,
  sessionStatePath,
  writeHookOutput,
} from "./lib/hookIo.ts";
import {
  type Decision,
  decisionInMode,
  dryRunChoresOf,
  gateDecision,
  sessionModeOf,
} from "./lib/tiers.ts";

const dryRunSuffix = "chore-dry-runs.json";
const ownersSuffix = "drive-owners.json";

await runFailOpen(async () => {
  const input = readHookInput();
  if (!input?.tool_name) return;
  let decision: Decision | undefined;
  if (input.tool_name === "Bash") {
    decision = bashDecision(input);
  } else {
    decision = await driveGateDecision({
      toolName: input.tool_name,
      // A spread copy fits the gate's Record of every argument.
      input: { ...input.tool_input },
      ownersOf: cachedOwnerLookup(
        driveOwnersOf,
        ownerCacheOf(sessionStatePath(input.session_id, ownersSuffix)),
      ),
    });
  }
  if (!decision) return;
  decision = decisionInMode(decision, sessionModeOf(process.env));
  writeHookOutput({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision.permissionDecision,
      permissionDecisionReason: decision.reason,
    },
  });
});

function bashDecision(input: HookInput): Decision | undefined {
  const command = input.tool_input?.command;
  if (typeof command !== "string") return undefined;
  const dryRunsPath = sessionStatePath(input.session_id, dryRunSuffix);
  if (input.hook_event_name === "PostToolUse") {
    recordDryRuns(dryRunsPath, dryRunChoresOf(command));
    return undefined;
  }
  return gateDecision({
    command,
    mode: sessionModeOf(process.env),
    dryRuns: readDryRuns(dryRunsPath),
  });
}

function recordDryRuns(path: string, chores: string[]): void {
  if (chores.length === 0) return;
  const recorded = new Set([...readDryRuns(path), ...chores]);
  writeFileSync(path, JSON.stringify([...recorded]));
}

function readDryRuns(path: string): string[] {
  const recorded = readJsonFile(path);
  return Array.isArray(recorded) ? recorded : [];
}

function ownerCacheOf(path: string): OwnerCache {
  return {
    read: (fileId) => {
      const owners = readOwners(path);
      if (!Object.hasOwn(owners, fileId)) return undefined;
      return Array.isArray(owners[fileId]) ? owners[fileId] : undefined;
    },
    write: (fileId, owners) => {
      writeFileSync(
        path,
        JSON.stringify({ ...readOwners(path), [fileId]: owners }),
      );
    },
  };
}

function readOwners(path: string): Record<string, string[]> {
  const recorded = readJsonFile(path);
  return recorded && typeof recorded === "object"
    ? (recorded as Record<string, string[]>)
    : {};
}
