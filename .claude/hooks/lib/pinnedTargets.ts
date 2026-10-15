// Decides the pinned-target guard: dev writes drop to ask while a pin is off, and gworkspace Sheets writes are allowed only on the dev ID. Pure; pinnedTargetGuard.ts does the I/O.
import { commandWordsOf, npmScriptOf } from "./bashReads.ts";

// Pinned in tracked code because sheets.config.json is gitignored, so git can't see an edit to it.
export const pinnedDevSpreadsheetId =
  "19gIs4w8-2Nsin5zTN1TojOR1HiiT9Y-jCctC7doAMqM";
export const devConfigPath = "packages/framework/sheets.config.json";

// The guard and its libs; git status on these is one pin, the dev config's ID the other.
export const pinningFiles = [
  ".claude/hooks/pinnedTargetGuard.ts",
  ".claude/hooks/lib/pinnedTargets.ts",
  ".claude/hooks/lib/sheetsConfigs.ts",
];
// Every Sheets write in workspace-mcp 1.28.0 that takes a spreadsheet_id; settings.json's hook matcher lists the same names.
export const guardedSheetsWrites = new Set([
  "mcp__gworkspace__modify_sheet_values",
  "mcp__gworkspace__format_sheet_range",
  "mcp__gworkspace__manage_conditional_formatting",
  "mcp__gworkspace__create_sheet",
  "mcp__gworkspace__append_table_rows",
  "mcp__gworkspace__manage_sheet_tab",
  "mcp__gworkspace__resize_sheet_dimensions",
  "mcp__gworkspace__move_sheet_rows",
  "mcp__gworkspace__manage_named_range",
  "mcp__gworkspace__manage_spreadsheet_comment",
]);
const devWrites = new Set([
  "dev:gen:configs",
  "dev:build",
  "dev:push",
  "dev:deploy",
  "dev:run",
]);

// Each entry says why a pin is off; undefined means git could not say.
export type DirtyPinningFiles = string[] | undefined;

export interface Decision {
  permissionDecision: "allow" | "ask" | "deny";
  reason: string;
}

export interface BashCommand {
  command: string;
  dirtyPinningFiles: DirtyPinningFiles;
}

export interface SheetsWrite {
  toolName: string | undefined;
  spreadsheetId: string | undefined;
  devSpreadsheetId: string | undefined;
  dirtyPinningFiles: DirtyPinningFiles;
}

// Turns git's dirty pinning files into pin-off reasons, adding one when the dev config names another spreadsheet.
export function pinsOff(
  dirtyFiles: string[] | undefined,
  configDevSpreadsheetId: string | undefined,
): DirtyPinningFiles {
  if (!dirtyFiles) return undefined;
  const reasons = dirtyFiles.map((path) => `${path} has uncommitted changes`);
  if (configDevSpreadsheetId !== pinnedDevSpreadsheetId) {
    reasons.push(`${devConfigPath} does not name the pinned dev spreadsheet`);
  }
  return reasons;
}

export function devWriteOf(command: string): string | undefined {
  let commands;
  try {
    commands = commandWordsOf(command);
  } catch {
    return /\bdev:/.test(command) ? "dev:*" : undefined;
  }
  for (const words of commands) {
    const script = npmScriptOf(words);
    if (!script) continue;
    if (devWrites.has(script.name)) return script.name;
    if (script.name === "dev:chore" && script.args.includes("--send")) {
      return script.name;
    }
  }
  return undefined;
}

export function bashDecision({
  command,
  dirtyPinningFiles,
}: BashCommand): Decision | undefined {
  const write = devWriteOf(command);
  if (!write || isClean(dirtyPinningFiles)) return undefined;
  return {
    permissionDecision: "ask",
    reason: `Pinned-target guard: \`${write}\` writes to the dev target, and ${dirtyShown(dirtyPinningFiles)}, so its standing yes is off until that is fixed.`,
  };
}

export function sheetsWriteDecision({
  toolName,
  spreadsheetId,
  devSpreadsheetId,
  dirtyPinningFiles,
}: SheetsWrite): Decision | undefined {
  if (toolName === undefined || !guardedSheetsWrites.has(toolName)) {
    return undefined;
  }
  const isDev =
    devSpreadsheetId !== undefined &&
    devSpreadsheetId !== "" &&
    spreadsheetId === devSpreadsheetId;
  if (!isDev) {
    return {
      permissionDecision: "ask",
      reason:
        "Pinned-target guard: this Sheets write targets a spreadsheet that is not the pinned dev spreadsheet. " +
        "It needs a yes that names the exact sheet, range and values.",
    };
  }
  if (!isClean(dirtyPinningFiles)) {
    return {
      permissionDecision: "ask",
      reason: `Pinned-target guard: this Sheets write targets the dev spreadsheet, but ${dirtyShown(dirtyPinningFiles)}.`,
    };
  }
  return {
    permissionDecision: "allow",
    reason:
      "Pinned-target guard: a write to the dev spreadsheet, from a clean pin.",
  };
}

// undefined means git could not say, which counts as dirty.
function isClean(dirtyPinningFiles: DirtyPinningFiles): boolean {
  return Array.isArray(dirtyPinningFiles) && dirtyPinningFiles.length === 0;
}

function dirtyShown(dirtyPinningFiles: DirtyPinningFiles): string {
  if (!Array.isArray(dirtyPinningFiles)) {
    return "the pinning files' git state could not be read";
  }
  return dirtyPinningFiles.join("; ");
}
