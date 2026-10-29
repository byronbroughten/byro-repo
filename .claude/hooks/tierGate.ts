// PreToolUse on Bash and the gworkspace write and create tools applies the tier gate; PostToolUse on Bash records each app chore dry run that ran, for a later --send.
// A Bash call naming gh also reads this claude's supervision record, since a supervising session's gh writes ask.
// Every Bash call gets the file-system lookups the step write rule and scratch `node` need, so the decision stays pure.
import { spawnSync } from "node:child_process";
import { lstatSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";

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
  callsGh,
  type Decision,
  dryRunChoresOf,
  gateDecision,
  sessionModeOf,
  type ShellPlaces,
  stepTargetsVariable,
} from "./lib/tiers/tiers.ts";

const dryRunSuffix = "chore-dry-runs.json";
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
  const dryRunsPath = sessionStatePath(input.session_id, dryRunSuffix);
  if (input.hook_event_name === "PostToolUse") {
    recordDryRuns(dryRunsPath, dryRunChoresOf(command));
    return undefined;
  }
  const mode = sessionModeOf(process.env);
  return gateDecision({
    command,
    mode,
    dryRuns: readDryRuns(dryRunsPath),
    supervising:
      mode === "interactive" && callsGh(command) && (await isSupervising()),
    places: shellPlacesOf(input),
  });
}

function shellPlacesOf(input: HookInput): ShellPlaces {
  const workspaceRoot = projectDirOf(input);
  return {
    workspaceRoot,
    tmpDir: tmpdir(),
    cwd: input.cwd ?? workspaceRoot,
    realPathOf: (path) => {
      try {
        return realpathSync.native(path);
      } catch {
        return undefined;
      }
    },
    isLink: (path) => {
      try {
        return lstatSync(path).isSymbolicLink();
      } catch {
        return false;
      }
    },
    isIgnored: isGitIgnored,
  };
}

// Asked of the path's own checkout, since the root ignores each package clone whole.
function isGitIgnored(path: string): boolean {
  const checked = spawnSync("git", [
    "-C",
    dirname(path),
    "check-ignore",
    "-q",
    path,
  ]);
  return checked.status === 0;
}

// Loaded here, not at the top, so only a gh call pays for the runner config; a failed lookup counts as supervising, so gh writes ask.
async function isSupervising(): Promise<boolean> {
  try {
    const { nearestClaudeAncestor } =
      await import("../../scripts/runner/claudeAncestor.ts");
    const { stateFolder } =
      await import("../../scripts/runner/runnerConfig.ts");
    const { SupervisionRecords } =
      await import("@byronbroughten/spec-runner/SupervisionRecords");
    const holder = nearestClaudeAncestor();
    if (!holder) return false;
    const record =
      await SupervisionRecords.init(stateFolder).runningRecordOf(holder);
    return record !== undefined;
  } catch {
    return true;
  }
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
