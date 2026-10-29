// Decides the gate for a gworkspace call by tier: a write is free on a file the developer owns, and asks on anyone else's; a runner step may write only its ticket's targets. Pure; tierGate.ts does the I/O, driveOwners.ts the real lookup.
import type { SheetsConfigEntry } from "../sheetsConfigs.ts";
import {
  blockerInstead,
  type Decision,
  decisionInMode,
  gateOf,
  needsYes,
  type SessionMode,
  stepTargetEntriesOf,
} from "./tiers.ts";

// A file's owner emails; undefined when the lookup failed.
export type OwnerLookup = (fileId: string) => Promise<string[] | undefined>;

// The session's record of each file's owners, so one file costs one lookup.
export interface OwnerCache {
  read(fileId: string): string[] | undefined;
  write(fileId: string, owners: string[]): void;
}

// A file a runner step's ticket names; id is undefined when its sheets config has none.
export interface StepTarget {
  label: string;
  id: string | undefined;
}

export interface DriveCall {
  toolName: string;
  input: Record<string, unknown>;
  ownersOf: OwnerLookup;
  mode: SessionMode;
  // Checked only in a runner step, which may write nothing else.
  targets: StepTarget[];
}

type FileWrite = Omit<DriveCall, "input"> & { fileId: string | undefined };

const developerAccounts = [
  "byronbroughten@gmail.com",
  "byronbroughtenai@gmail.com",
];
// Every Sheets write in workspace-mcp 1.28.0 that takes a spreadsheet_id.
const sheetsWrites = new Set([
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
// Every Docs write in workspace-mcp 1.28.0 that takes a document_id.
const docsWrites = new Set([
  "mcp__gworkspace__modify_doc_text",
  "mcp__gworkspace__find_and_replace_doc",
  "mcp__gworkspace__insert_doc_elements",
  "mcp__gworkspace__batch_update_doc",
  "mcp__gworkspace__update_paragraph_style",
  "mcp__gworkspace__update_doc_headers_footers",
  "mcp__gworkspace__manage_doc_tab",
  "mcp__gworkspace__insert_doc_image",
  "mcp__gworkspace__create_table_with_data",
]);

// Each makes or exports the developer's own new file, so it reaches no one else.
const fileCreations = new Set([
  "mcp__gworkspace__create_spreadsheet",
  "mcp__gworkspace__create_doc",
  "mcp__gworkspace__create_drive_file",
  "mcp__gworkspace__create_drive_folder",
  "mcp__gworkspace__copy_drive_file",
  "mcp__gworkspace__import_to_google_sheets",
  "mcp__gworkspace__import_to_google_doc",
  "mcp__gworkspace__import_to_google_slides",
  "mcp__gworkspace__export_doc_to_pdf",
]);
// The tools that can change who reaches a file, and update_drive_file's arguments that do.
const sharing = {
  manageDriveAccess: "mcp__gworkspace__manage_drive_access",
  setDriveFilePermissions: "mcp__gworkspace__set_drive_file_permissions",
  updateDriveFile: "mcp__gworkspace__update_drive_file",
  settings: ["writers_can_share", "copy_requires_writer_permission"],
} as const;

export async function driveGateDecision(
  call: DriveCall,
): Promise<Decision | undefined> {
  const decision = await baseDecision(call);
  return decision && decisionInMode(decision, call.mode);
}

async function baseDecision({
  input,
  ...call
}: DriveCall): Promise<Decision | undefined> {
  const { toolName } = call;
  if (fileCreations.has(toolName)) {
    return gateOf(
      "allow",
      "a new file of the developer's reaches no one else.",
    );
  }
  if (toolName === sharing.manageDriveAccess) {
    return accessAsk(toolName, input, manageDriveAccessChange(input));
  }
  if (toolName === sharing.setDriveFilePermissions) {
    return accessAsk(toolName, input, settingsChange(input));
  }
  if (toolName === sharing.updateDriveFile) {
    const change = settingsChange(input);
    if (change !== undefined) return accessAsk(toolName, input, change);
    return writeDecision({ ...call, fileId: stringOf(input.file_id) });
  }
  const fileIdKey = fileIdKeyOf(toolName);
  if (fileIdKey === undefined) return undefined;
  return writeDecision({ ...call, fileId: stringOf(input[fileIdKey]) });
}

// The files a runner step's ticket names; anything unreadable names none, so every write is denied.
export function stepTargetsOf(
  json: string | undefined,
  sheetsConfigs: SheetsConfigEntry[],
): StepTarget[] {
  return stepTargetEntriesOf(json).flatMap((target) => {
    if (target?.kind === "doc" && typeof target.id === "string") {
      return [{ label: "doc", id: target.id }];
    }
    const config = sheetsConfigs.find(
      ({ scriptPrefix }) => scriptPrefix === target?.name,
    );
    if (target?.kind !== "spreadsheet" || config === undefined) return [];
    return [
      { label: `${config.scriptPrefix} spreadsheet`, id: config.spreadsheetId },
    ];
  });
}

// A failed lookup isn't recorded, so a fixed token is picked up on the next write.
export function cachedOwnerLookup(
  lookup: OwnerLookup,
  cache: OwnerCache,
): OwnerLookup {
  return async (fileId) => {
    const cached = cache.read(fileId);
    if (cached !== undefined) return cached;
    const owners = await lookup(fileId);
    if (owners !== undefined) cache.write(fileId, owners);
    return owners;
  };
}

function accessAsk(
  toolName: string,
  input: Record<string, unknown>,
  change: string | undefined,
): Decision {
  const file = stringOf(input.file_id) ?? "with no ID";
  return needsYes(
    `\`${shortNameOf(toolName)}\` ${change ?? "changes access"} on file \`${file}\`, and an access change reaches someone else`,
  );
}

function manageDriveAccessChange(
  input: Record<string, unknown>,
): string | undefined {
  const role = stringOf(input.role) ?? "reader";
  const action = stringOf(input.action);
  if (action === "grant") return `grants ${granteeOf(input)} ${role} access`;
  if (action === "grant_batch") {
    return `grants ${recipientsShown(input.recipients)}`;
  }
  if (action === "update") {
    return `changes permission \`${stringOf(input.permission_id)}\` to ${role}`;
  }
  if (action === "revoke") {
    return `revokes permission \`${stringOf(input.permission_id)}\``;
  }
  if (action === "transfer_owner") {
    return `transfers ownership to ${stringOf(input.new_owner_email)}`;
  }
  return undefined;
}

function granteeOf(input: Record<string, unknown>): string {
  const shareType = stringOf(input.share_type);
  if (shareType === "anyone") return "anyone";
  if (shareType === "domain") return `anyone at ${stringOf(input.share_with)}`;
  return stringOf(input.share_with) ?? "an unnamed grantee";
}

function recipientsShown(recipients: unknown): string {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return "access to unnamed recipients";
  }
  return recipients
    .map((recipient) => {
      const who = stringOf(recipient?.email) ?? stringOf(recipient?.domain);
      return `${who ?? "an unnamed recipient"} ${stringOf(recipient?.role) ?? "reader"} access`;
    })
    .join(", ");
}

// The sharing settings a call sets; undefined when it sets none.
function settingsChange(input: Record<string, unknown>): string | undefined {
  const changes: string[] = [];
  const linkSharing = stringOf(input.link_sharing);
  if (linkSharing === "off") {
    changes.push("turns off anyone-with-the-link access");
  } else if (linkSharing !== undefined) {
    changes.push(`lets anyone with the link in as ${linkSharing}`);
  }
  sharing.settings.forEach((setting) => {
    const value = input[setting];
    if (value !== undefined && value !== null) {
      changes.push(`sets ${setting} to ${String(value)}`);
    }
  });
  // A folder shares its files with everyone it's shared with.
  const addedParents = stringOf(input.add_parents);
  if (addedParents !== undefined) {
    changes.push(
      `moves it into folder \`${addedParents}\`, sharing it with whoever that folder is shared with`,
    );
  }
  return changes.length === 0 ? undefined : changes.join(" and ");
}

async function writeDecision({
  toolName,
  fileId,
  ownersOf,
  mode,
  targets,
}: FileWrite): Promise<Decision> {
  const tool = `\`${shortNameOf(toolName)}\``;
  if (fileId === undefined) {
    return gateOf("ask", `${tool} names no file to look its owner up by.`);
  }
  if (mode === "runnerStep" && !targets.some(({ id }) => id === fileId)) {
    return gateOf(
      "deny",
      `${tool} writes to file \`${fileId}\`, which isn't among this ticket's targets (${targetsShown(targets)}), so ${blockerInstead}.`,
    );
  }
  const owners = await ownersOf(fileId);
  if (owners === undefined) {
    return needsYes(
      `${tool} writes to file \`${fileId}\`, whose owner couldn't be looked up`,
    );
  }
  if (owners.some(isDeveloperAccount)) {
    return gateOf(
      "allow",
      `the developer owns file \`${fileId}\`, and Google's version history undoes ${tool}.`,
    );
  }
  return needsYes(
    `${tool} writes to file \`${fileId}\`, owned by ${ownersShown(owners)}, which neither of the developer's accounts owns`,
  );
}

function targetsShown(targets: StepTarget[]): string {
  if (targets.length === 0) return "none";
  return targets
    .map(
      ({ label, id }) =>
        `${label} ${id === undefined ? "with no ID" : `\`${id}\``}`,
    )
    .join(", ");
}

function fileIdKeyOf(toolName: string): string | undefined {
  if (sheetsWrites.has(toolName)) return "spreadsheet_id";
  if (docsWrites.has(toolName)) return "document_id";
  return undefined;
}

function shortNameOf(toolName: string): string {
  return toolName.replace(/^mcp__gworkspace__/, "");
}

function ownersShown(owners: string[]): string {
  return owners.length === 0 ? "no listed owner" : owners.join(", ");
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function isDeveloperAccount(email: string): boolean {
  return developerAccounts.includes(email.toLowerCase());
}
