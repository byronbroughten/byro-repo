// Decides the primary-edit guard: no session leaves an edit, commit or merge in a primary checkout, where runs land. Pure; primaryEditGuard.ts does the I/O.
import { resolve } from "node:path";

import {
  type GuardDecision,
  primaryCheckoutOf,
  primaryCommitsOf,
} from "./branchGuard.ts";
import type { ToolInput } from "./hookIo.ts";

export interface PrimaryEditInput {
  toolInput: ToolInput;
  cwd: string;
  primaryCheckouts: string[];
  // The path with symlinks resolved, for a path that may not exist yet.
  realPathOf(path: string): string;
  isIgnored(checkout: string, path: string): boolean;
}

const workspaceWay =
  "Runs land there, so work in a workspace: `/start-issue <repo> <n>` moves this session into an issue's; otherwise `npm run issue:start -- <repo> <n>` for an issue, or `npm run issue:start -- --session <slug>` for anything else, then continue at the printed path.";

export function primaryEditDecision(props: PrimaryEditInput): GuardDecision {
  const reason = fileDenyReason(props) ?? commitDenyReason(props);
  if (reason) {
    return {
      permissionDecision: "deny",
      reason: guardMessage(`${reason} ${workspaceWay}`),
    };
  }
  return {
    permissionDecision: "allow",
    reason: guardMessage("nothing here edits a primary checkout."),
  };
}

function fileDenyReason({
  toolInput,
  cwd,
  primaryCheckouts,
  realPathOf,
  isIgnored,
}: PrimaryEditInput): string | undefined {
  const filePath = toolInput.file_path ?? toolInput.notebook_path;
  if (filePath === undefined) return undefined;
  const path = realPathOf(resolve(cwd, filePath));
  const checkout = primaryCheckoutOf(path, primaryCheckouts);
  if (!checkout || isIgnored(checkout, path)) return undefined;
  return `${path} is in the primary checkout ${checkout}.`;
}

function commitDenyReason({
  toolInput: { command },
  cwd,
  primaryCheckouts,
}: PrimaryEditInput): string | undefined {
  if (command === undefined) return undefined;
  const [action] = primaryCommitsOf({ command, cwd, primaryCheckouts });
  if (!action) return undefined;
  return `\`git ${action.subcommand}\` would ${action.subcommand} in the primary checkout ${action.checkout}.`;
}

function guardMessage(reason: string): string {
  return `Primary-edit guard: ${reason}`;
}
