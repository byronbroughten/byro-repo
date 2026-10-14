// Only ever allows, since a -p run denies any .claude/ write prompt no hook answers.
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
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
  replace_all?: unknown;
}

export const permissionKeys = [
  "allowed-tools",
  "permissionMode",
  "hooks",
  "mcpServers",
] as const;

const permissionKeyLine = new RegExp(
  `^\\s*["']?(${permissionKeys.join("|")})["']?\\s*:`,
  "m",
);

export function skillWriteDecision({
  toolName,
  toolInput,
  workspaceRoot,
  allowedGlobs,
}: SkillWriteRequest): "allow" | undefined {
  if (toolName !== "Edit" && toolName !== "Write") return undefined;
  const { file_path: filePath } = toolInput;
  if (typeof filePath !== "string") return undefined;
  const root = realpathSync(workspaceRoot);
  const realPath = realPathOf(resolve(root, filePath));
  if (realPath === undefined) return undefined;
  const pathInRoot = relative(root, realPath);
  if (pathInRoot.startsWith("..") || isAbsolute(pathInRoot)) return undefined;
  if (!allowedGlobs.some((glob) => matchesGlob(pathInRoot, glob))) {
    return undefined;
  }
  const writtenFile = writtenFileOf(toolName, toolInput, realPath);
  if (writtenFile === undefined || permissionKeyLine.test(writtenFile)) {
    return undefined;
  }
  return "allow";
}

// The whole file after an Edit, so an edit can't widen or uncover a key that new_string alone doesn't show.
function writtenFileOf(
  toolName: "Edit" | "Write",
  {
    content,
    old_string: oldString,
    new_string: newString,
    replace_all: replacesAll,
  }: SkillWriteToolInput,
  realPath: string,
): string | undefined {
  if (toolName === "Write") {
    return typeof content === "string" ? content : undefined;
  }
  if (typeof oldString !== "string" || typeof newString !== "string") {
    return undefined;
  }
  if (oldString === "" || !existsSync(realPath)) return undefined;
  const file = readFileSync(realPath, "utf8");
  if (!file.includes(oldString)) return undefined;
  if (replacesAll === true) return file.replaceAll(oldString, () => newString);
  return file.replace(oldString, () => newString);
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
