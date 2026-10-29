// Answers a runner step's permission prompt: Claude Code prompts for a protected path such as .claude/ or .vscode/ even after the tier gate allows, and a -p step denies what no hook answers. Pure; stepPermission.ts does the I/O.
import { isAbsolute, resolve } from "node:path";

import { isStepWritable } from "./stepWrites.ts";
import { gateDecision, type SessionMode, type ShellPlaces } from "./tiers.ts";

export interface PermissionCall {
  toolName: string;
  toolInput: {
    file_path?: unknown;
    command?: unknown;
    notebook_path?: unknown;
  };
  mode: SessionMode;
  dryRuns: string[];
  places: ShellPlaces;
}

// A Map, so a tool name such as `constructor` finds nothing.
const toolAnswers = new Map<string, (call: PermissionCall) => boolean>([
  ["Edit", isWritable],
  ["Write", isWritable],
  // The gate's own decision, so a Bash write and an Edit to one path get one answer.
  ["Bash", isGateAllowed],
  ["Read", () => true],
]);

// Only ever allows; with no decision the step records a `denied-tool` blocker. A settings deny rule wins before any hook fires.
export function stepPermissionDecision(
  call: PermissionCall,
): "allow" | undefined {
  if (call.mode !== "runnerStep") return undefined;
  const isAllowed = toolAnswers.get(call.toolName)?.(call) ?? false;
  return isAllowed ? "allow" : undefined;
}

function isWritable({
  toolInput: { file_path: path },
  places,
}: PermissionCall): boolean {
  if (typeof path !== "string") return false;
  const absolute = isAbsolute(path) ? path : resolve(places.cwd, path);
  return isStepWritable(absolute, places);
}

function isGateAllowed({
  toolInput: { command },
  mode,
  dryRuns,
  places,
}: PermissionCall): boolean {
  if (typeof command !== "string") return false;
  const decision = gateDecision({ command, mode, dryRuns, places });
  return decision?.permissionDecision === "allow";
}
