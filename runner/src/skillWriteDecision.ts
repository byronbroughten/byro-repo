// Decides the PermissionRequest hook skillWriteHook.ts runs on every step, so a headless step can write skills and agent definitions.
// Claude Code prompts for any write under .claude/, and allow rules can't pre-approve it; a -p run denies an unanswered prompt.
// It only ever allows: anything it doesn't allow falls through to that denial.
import { existsSync, lstatSync, realpathSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  matchesGlob,
  relative,
  resolve,
} from "node:path";

export interface SkillWriteRequest {
  toolName: string;
  toolInput: SkillWriteToolInput;
  workspaceRoot: string;
  allowedGlobs: string[];
}

export interface SkillWriteToolInput {
  file_path?: unknown;
  content?: unknown;
  old_string?: unknown;
  new_string?: unknown;
}

const permissionKeyLine = /^\s*(allowed-tools|permissionMode|hooks)\s*:/m;

const writtenTextKeys = { Edit: "new_string", Write: "content" } as const;

export function skillWriteDecision({
  toolName,
  toolInput,
  workspaceRoot,
  allowedGlobs,
}: SkillWriteRequest): "allow" | undefined {
  if (toolName !== "Edit" && toolName !== "Write") return undefined;
  const { file_path: filePath } = toolInput;
  const writtenText = toolInput[writtenTextKeys[toolName]];
  if (typeof filePath !== "string" || typeof writtenText !== "string") {
    return undefined;
  }
  if (permissionKeyLine.test(writtenText)) return undefined;
  const root = realpathSync(workspaceRoot);
  const realPath = realPathOf(resolve(root, filePath));
  if (realPath === undefined) return undefined;
  const pathInRoot = relative(root, realPath);
  if (pathInRoot.startsWith("..") || isAbsolute(pathInRoot)) return undefined;
  if (!allowedGlobs.some((glob) => matchesGlob(pathInRoot, glob))) {
    return undefined;
  }
  return "allow";
}

// A Write can create the file and its folders, so resolve the nearest ancestor that exists; a dangling symlink resolves to nothing.
function realPathOf(path: string): string | undefined {
  if (existsSync(path)) return realpathSync(path);
  if (isSymlink(path)) return undefined;
  const parent = dirname(path);
  if (parent === path) return path;
  const realParent = realPathOf(parent);
  if (realParent === undefined) return undefined;
  return join(realParent, basename(path));
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
