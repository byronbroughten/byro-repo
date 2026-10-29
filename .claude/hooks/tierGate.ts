// PreToolUse on Bash and the gworkspace write and create tools applies the tier gate; PostToolUse on Bash records each app chore dry run that ran, for a later --send.
// Every Bash call gets the file-system lookups the step write rule and scratch `node` need, so the decision stays pure.
import { writeFileSync } from "node:fs";

import { dryRuns, shellPlacesOf } from "./lib/gateLookups.ts";
import {
  type HookInput,
  projectDirOf,
  readHookInput,
  readJsonFile,
  runFailOpen,
  sessionStatePath,
  writeHookOutput,
} from "./lib/hookIo.ts";
import { readSheetsConfigs } from "./lib/sheetsConfigs.ts";
import { driveOwnersOf } from "./lib/tiers/driveOwners.ts";
import {
  cachedOwnerLookup,
  driveGateDecision,
  type OwnerCache,
  stepTargetsOf,
} from "./lib/tiers/driveTiers.ts";
import {
  type Decision,
  dryRunChoresOf,
  gateDecision,
  sessionModeOf,
  spreadsheetTargetsOf,
  stepTargetsVariable,
} from "./lib/tiers/tiers.ts";

const ownersSuffix = "drive-owners.json";

await runFailOpen(async () => {
  const input = readHookInput();
  if (!input?.tool_name) return;
  let decision: Decision | undefined;
  if (input.tool_name === "Bash") {
    decision = await bashDecision(input);
  } else {
    const projectDir = projectDirOf(input);
    decision = await driveGateDecision({
      toolName: input.tool_name,
      // A spread copy fits the gate's Record of every argument.
      input: { ...input.tool_input },
      ownersOf: cachedOwnerLookup(
        driveOwnersOf,
        ownerCacheOf(sessionStatePath(input.session_id, ownersSuffix)),
      ),
      mode: sessionModeOf(process.env),
      targets: stepTargetsOf(
        process.env[stepTargetsVariable],
        readSheetsConfigs(projectDir),
      ),
    });
  }
  if (!decision) return;
  writeHookOutput({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision.permissionDecision,
      permissionDecisionReason: decision.reason,
    },
  });
});

async function bashDecision(input: HookInput): Promise<Decision | undefined> {
  const command = input.tool_input?.command;
  if (typeof command !== "string") return undefined;
  if (input.hook_event_name === "PostToolUse") {
    dryRuns.record(input.session_id, dryRunChoresOf(command));
    return undefined;
  }
  return gateDecision({
    command,
    mode: sessionModeOf(process.env),
    dryRuns: dryRuns.read(input.session_id),
    places: shellPlacesOf(input),
    spreadsheetTargets: spreadsheetTargetsOf(process.env[stepTargetsVariable]),
  });
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
